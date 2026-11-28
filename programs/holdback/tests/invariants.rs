//! Property test: random instruction sequences from honest and hostile
//! signers, checked against a reference model after every step.
//!
//! Invariants (numbering as in docs/THREAT_MODEL.md):
//!   I1  funds leave a vault only to the hold's sender or recipient
//!   I2  nothing reaches the recipient before `release_at`, except an early
//!       release signed by the sender
//!   I3  the oracle never moves funds and never reduces `release_at`
//!   I4  the relayer only routes funds to the box owner, or to the recipient
//!       through a hold whose sender is the owner
//!   I5  conservation: balances + vaults always add up to the initial supply
//!   I6  every terminal hold can be closed and its rent returns to the payer
//!
//! The model predicts whether each instruction must succeed or fail; any
//! disagreement with the program is a violation, as is any balance that
//! differs from the model.
//!
//! Case count: `HOLDBACK_FUZZ_CASES` (default 2,000). A JSON summary is
//! written to `HOLDBACK_FUZZ_REPORT` when set.

mod common;

use std::cell::RefCell;

use common::*;
use holdback::constants::status;
use proptest::prelude::*;
use proptest::test_runner::{Config as RunnerConfig, TestCaseError, TestRunner};
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;

const SENDERS: usize = 3; // index 2 is the deposit-box owner
const BOX_OWNER: usize = 2;
const RECIPIENTS: usize = 3;
const START_TOKENS: u64 = 1_000_000_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Actor {
    /// The hold's sender, or the deposit-box owner for box instructions.
    Owner,
    Relayer,
    Oracle,
    Attacker,
}

#[derive(Debug, Clone)]
enum Op {
    CreateToken {
        sender: usize,
        recipient: usize,
        token22: bool,
        amount: u64,
        window: u32,
        tier: u8,
    },
    CreateSol {
        sender: usize,
        recipient: usize,
        amount: u64,
        window: u32,
        tier: u8,
    },
    OpenFromBox {
        by: Actor,
        recipient: usize,
        amount: u64,
        window: u32,
        tier: u8,
    },
    Withdraw {
        by: Actor,
        amount: u64,
        to_attacker: bool,
    },
    Reclaim {
        hold: usize,
        by: Actor,
        to_attacker: bool,
    },
    Release {
        hold: usize,
        by: Actor,
        early: bool,
        to_attacker: bool,
    },
    Extend {
        hold: usize,
        by: Actor,
        delta: i64,
        tier: u8,
    },
    Close {
        hold: usize,
        rent_to_attacker: bool,
    },
    Warp {
        secs: u32,
    },
}

fn actor() -> impl Strategy<Value = Actor> {
    prop_oneof![
        4 => Just(Actor::Owner),
        2 => Just(Actor::Relayer),
        1 => Just(Actor::Oracle),
        2 => Just(Actor::Attacker),
    ]
}

fn window() -> impl Strategy<Value = u32> {
    prop_oneof![
        1 => Just(0u32),
        4 => 1u32..=3_600,
        4 => DEFAULT_WINDOW..=MAX_WINDOW,
        1 => (MAX_WINDOW + 1)..=(MAX_WINDOW * 2),
    ]
}

fn token_amount() -> impl Strategy<Value = u64> {
    prop_oneof![1 => Just(0u64), 9 => 1u64..=1_000_000]
}

fn sol_amount() -> impl Strategy<Value = u64> {
    prop_oneof![1 => Just(0u64), 1 => 1u64..=800_000, 8 => 900_000u64..=5_000_000]
}

fn op() -> impl Strategy<Value = Op> {
    let tier = 0u8..=5;
    prop_oneof![
        4 => (0..2usize, 0..RECIPIENTS, any::<bool>(), token_amount(), window(), tier.clone())
            .prop_map(|(sender, recipient, token22, amount, window, tier)| Op::CreateToken {
                sender, recipient, token22, amount, window, tier
            }),
        3 => (0..2usize, 0..RECIPIENTS, sol_amount(), window(), tier.clone())
            .prop_map(|(sender, recipient, amount, window, tier)| Op::CreateSol {
                sender, recipient, amount, window, tier
            }),
        3 => (actor(), 0..RECIPIENTS, token_amount(), window(), tier.clone())
            .prop_map(|(by, recipient, amount, window, tier)| Op::OpenFromBox {
                by, recipient, amount, window, tier
            }),
        2 => (actor(), token_amount(), prop::bool::weighted(0.25))
            .prop_map(|(by, amount, to_attacker)| Op::Withdraw { by, amount, to_attacker }),
        5 => (any::<usize>(), actor(), prop::bool::weighted(0.2))
            .prop_map(|(hold, by, to_attacker)| Op::Reclaim { hold, by, to_attacker }),
        5 => (any::<usize>(), actor(), any::<bool>(), prop::bool::weighted(0.2))
            .prop_map(|(hold, by, early, to_attacker)| Op::Release { hold, by, early, to_attacker }),
        4 => (any::<usize>(), actor(), -5_000i64..=(MAX_WINDOW as i64 * 2), tier)
            .prop_map(|(hold, by, delta, tier)| Op::Extend { hold, by, delta, tier }),
        2 => (any::<usize>(), prop::bool::weighted(0.2))
            .prop_map(|(hold, rent_to_attacker)| Op::Close { hold, rent_to_attacker }),
        4 => prop_oneof![0u32..=120, 0u32..=4_000, 0u32..=(MAX_WINDOW + 10)]
            .prop_map(|secs| Op::Warp { secs }),
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Sol,
    Token { token22: bool },
}

#[derive(Debug, Clone)]
struct ModelHold {
    address: Address,
    sender: usize,
    recipient: usize,
    kind: Kind,
    amount: u64,
    created_at: i64,
    release_at: i64,
    tier: u8,
    status: u8,
    from_box: bool,
    closed: bool,
}

/// What the balances must be if the program is correct.
struct Model {
    sender_tokens: [[u64; 2]; SENDERS],
    recipient_tokens: [[u64; 2]; RECIPIENTS],
    recipient_lamports: [u64; RECIPIENTS],
    box_tokens: u64,
    received: [u32; RECIPIENTS],
    reclaimed: [u32; RECIPIENTS],
    released: [u32; RECIPIENTS],
    holds: Vec<ModelHold>,
    next_nonce: u64,
}

struct Harness {
    world: World,
    senders: [Keypair; SENDERS],
    recipients: [Address; RECIPIENTS],
    attacker: Keypair,
    attacker_lamports: u64,
    rent_floor: u64,
    model: Model,
    executed: u64,
}

impl Harness {
    fn new() -> Self {
        let mut world = World::new();
        let senders = [
            world.funded_keypair(),
            world.funded_keypair(),
            world.funded_keypair(),
        ];
        let recipients = [
            Address::new_unique(),
            Address::new_unique(),
            Address::new_unique(),
        ];
        let attacker = world.funded_keypair();
        let mints = [world.usdc, world.token22];

        for mint in mints {
            for sender in &senders {
                world.fund_tokens(&sender.pubkey(), mint, START_TOKENS);
            }
            for recipient in &recipients {
                world.fund_tokens(recipient, mint, 0);
            }
            world.fund_tokens(&attacker.pubkey(), mint, 0);
        }

        let relayer = world.relayer.insecure_clone();
        let owner = senders[BOX_OWNER].pubkey();
        let ix = world.ix_init_deposit_box(&relayer.pubkey(), &owner, world.usdc);
        world.send(ix, &[&relayer]).unwrap();
        let usdc = world.usdc;
        world.fund_tokens(&box_pda(&owner), usdc, START_TOKENS);

        let rent_floor = world.svm.minimum_balance_for_rent_exemption(0);
        let attacker_lamports = world.lamports(&attacker.pubkey());
        Self {
            world,
            senders,
            recipients,
            attacker,
            attacker_lamports,
            rent_floor,
            model: Model {
                sender_tokens: [[START_TOKENS; 2]; SENDERS],
                recipient_tokens: [[0; 2]; RECIPIENTS],
                recipient_lamports: [0; RECIPIENTS],
                box_tokens: START_TOKENS,
                received: [0; RECIPIENTS],
                reclaimed: [0; RECIPIENTS],
                released: [0; RECIPIENTS],
                holds: Vec::new(),
                next_nonce: 1,
            },
            executed: 0,
        }
    }

    fn mint(&self, token22: bool) -> MintRef {
        if token22 {
            self.world.token22
        } else {
            self.world.usdc
        }
    }

    fn signer(&self, by: Actor, owner: usize) -> Keypair {
        match by {
            Actor::Owner => self.senders[owner].insecure_clone(),
            Actor::Relayer => self.world.relayer.insecure_clone(),
            Actor::Oracle => self.world.oracle.insecure_clone(),
            Actor::Attacker => self.attacker.insecure_clone(),
        }
    }

    /// Runs one generated case: the ops, then the I6 sweep that settles and
    /// closes everything the case opened.
    fn run_case(&mut self, ops: &[Op]) -> Result<(), TestCaseError> {
        let first = self.model.holds.len();
        for op in ops {
            self.apply(op, first)?;
            self.check_balances(op)?;
        }
        self.settle_and_close(first)?;
        self.check_stats()
    }

    fn apply(&mut self, op: &Op, first: usize) -> Result<(), TestCaseError> {
        let now = self.world.now();
        match *op {
            Op::Warp { secs } => {
                self.world.warp(i64::from(secs));
                Ok(())
            }

            Op::CreateToken {
                sender,
                recipient,
                token22,
                amount,
                window,
                tier,
            } => {
                let expect = amount > 0 && (1..=MAX_WINDOW).contains(&window) && tier <= 4;
                let mint = self.mint(token22);
                let key = self.senders[sender].insecure_clone();
                let nonce = self.take_nonce();
                let ix = self.world.ix_create_hold(
                    &key.pubkey(),
                    &self.recipients[recipient],
                    mint,
                    nonce,
                    amount,
                    window,
                    tier,
                );
                let ok = self.exec(ix, &key, expect, op)?;
                if ok {
                    self.model.sender_tokens[sender][usize::from(token22)] -= amount;
                    self.model.received[recipient] += 1;
                    self.model.holds.push(ModelHold {
                        address: hold_pda(&key.pubkey(), nonce),
                        sender,
                        recipient,
                        kind: Kind::Token { token22 },
                        amount,
                        created_at: now,
                        release_at: now + i64::from(window),
                        tier,
                        status: status::PENDING,
                        from_box: false,
                        closed: false,
                    });
                }
                Ok(())
            }

            Op::CreateSol {
                sender,
                recipient,
                amount,
                window,
                tier,
            } => {
                let expect =
                    amount >= self.rent_floor && (1..=MAX_WINDOW).contains(&window) && tier <= 4;
                let key = self.senders[sender].insecure_clone();
                let nonce = self.take_nonce();
                let ix = self.world.ix_create_hold_sol(
                    &key.pubkey(),
                    &self.recipients[recipient],
                    nonce,
                    amount,
                    window,
                    tier,
                );
                let ok = self.exec(ix, &key, expect, op)?;
                if ok {
                    self.model.received[recipient] += 1;
                    self.model.holds.push(ModelHold {
                        address: hold_pda(&key.pubkey(), nonce),
                        sender,
                        recipient,
                        kind: Kind::Sol,
                        amount,
                        created_at: now,
                        release_at: now + i64::from(window),
                        tier,
                        status: status::PENDING,
                        from_box: false,
                        closed: false,
                    });
                }
                Ok(())
            }

            Op::OpenFromBox {
                by,
                recipient,
                amount,
                window,
                tier,
            } => {
                // I4: only the relayer, never below the default window.
                let expect = by == Actor::Relayer
                    && amount > 0
                    && amount <= self.model.box_tokens
                    && (DEFAULT_WINDOW..=MAX_WINDOW).contains(&window)
                    && tier <= 4;
                let key = self.signer(by, BOX_OWNER);
                let owner = self.senders[BOX_OWNER].pubkey();
                let nonce = self.take_nonce();
                let ix = self.world.ix_open_hold_from_deposit(
                    &key.pubkey(),
                    &owner,
                    &self.recipients[recipient],
                    self.world.usdc,
                    nonce,
                    amount,
                    window,
                    tier,
                );
                let ok = self.exec(ix, &key, expect, op)?;
                if ok {
                    self.model.box_tokens -= amount;
                    self.model.received[recipient] += 1;
                    self.model.holds.push(ModelHold {
                        address: hold_pda(&owner, nonce),
                        sender: BOX_OWNER,
                        recipient,
                        kind: Kind::Token { token22: false },
                        amount,
                        created_at: now,
                        release_at: now + i64::from(window),
                        tier,
                        status: status::PENDING,
                        from_box: true,
                        closed: false,
                    });
                }
                Ok(())
            }

            Op::Withdraw {
                by,
                amount,
                to_attacker,
            } => {
                // I4: owner or relayer may sign, the owner is the only payee.
                let expect = matches!(by, Actor::Owner | Actor::Relayer)
                    && !to_attacker
                    && amount > 0
                    && amount <= self.model.box_tokens;
                let key = self.signer(by, BOX_OWNER);
                let owner = self.senders[BOX_OWNER].pubkey();
                let usdc = self.world.usdc;
                let payee = if to_attacker {
                    self.attacker.pubkey()
                } else {
                    owner
                };
                let destination = ata(&payee, &usdc.mint, &usdc.program);
                let ix = self.world.ix_withdraw_deposit(
                    &key.pubkey(),
                    &owner,
                    usdc,
                    &destination,
                    amount,
                );
                let ok = self.exec(ix, &key, expect, op)?;
                if ok {
                    self.model.box_tokens -= amount;
                    self.model.sender_tokens[BOX_OWNER][0] += amount;
                }
                Ok(())
            }

            Op::Reclaim {
                hold,
                by,
                to_attacker,
            } => {
                let Some(index) = self.pick(hold, first) else {
                    return Ok(());
                };
                let h = self.model.holds[index].clone();
                // I1 + I4: sender, or relayer for box holds; refund to sender only.
                let expect = h.status == status::PENDING
                    && now < h.release_at
                    && !to_attacker
                    && (by == Actor::Owner || (h.from_box && by == Actor::Relayer));
                let key = self.signer(by, h.sender);
                let sender = self.senders[h.sender].pubkey();
                let payee = if to_attacker {
                    self.attacker.pubkey()
                } else {
                    sender
                };
                let (ix, rent_before) = match h.kind {
                    Kind::Sol => (
                        self.world.ix_reclaim_sol(&key.pubkey(), &h.address, &payee),
                        0,
                    ),
                    Kind::Token { token22 } => {
                        let mint = self.mint(token22);
                        let vault = ata(&h.address, &mint.mint, &mint.program);
                        let destination = ata(&payee, &mint.mint, &mint.program);
                        (
                            self.world
                                .ix_reclaim(&key.pubkey(), &h.address, &destination),
                            self.world.lamports(&vault),
                        )
                    }
                };
                let payer_before = self.rent_payer_lamports(&h);
                let sender_before = self.world.lamports(&sender);
                let ok = self.exec(ix, &key, expect, op)?;
                if ok {
                    match h.kind {
                        Kind::Sol => {
                            prop_assert_eq!(
                                self.world.lamports(&sender),
                                sender_before + h.amount,
                                "SOL refund amount"
                            );
                        }
                        Kind::Token { token22 } => {
                            self.model.sender_tokens[h.sender][usize::from(token22)] += h.amount;
                            prop_assert_eq!(
                                self.rent_payer_lamports(&h),
                                payer_before + rent_before,
                                "I6 vault rent"
                            );
                        }
                    }
                    self.model.reclaimed[h.recipient] += 1;
                    self.model.holds[index].status = status::RECLAIMED;
                }
                Ok(())
            }

            Op::Release {
                hold,
                by,
                early,
                to_attacker,
            } => {
                let Some(index) = self.pick(hold, first) else {
                    return Ok(());
                };
                let h = self.model.holds[index].clone();
                // I2: after the window anyone may crank; before it only the sender.
                let expect = h.status == status::PENDING
                    && !to_attacker
                    && if early {
                        by == Actor::Owner
                    } else {
                        now >= h.release_at
                    };
                let key = self.signer(by, h.sender);
                let payee = if to_attacker {
                    self.attacker.pubkey()
                } else {
                    self.recipients[h.recipient]
                };
                let (ix, rent_before) = match h.kind {
                    Kind::Sol => (
                        self.world
                            .ix_release_sol(&key.pubkey(), &h.address, &payee, early),
                        0,
                    ),
                    Kind::Token { token22 } => {
                        let mint = self.mint(token22);
                        let vault = ata(&h.address, &mint.mint, &mint.program);
                        (
                            self.world
                                .ix_release(&key.pubkey(), &h.address, &payee, early),
                            self.world.lamports(&vault),
                        )
                    }
                };
                let payer_before = self.rent_payer_lamports(&h);
                let ok = self.exec(ix, &key, expect, op)?;
                if ok {
                    match h.kind {
                        Kind::Sol => self.model.recipient_lamports[h.recipient] += h.amount,
                        Kind::Token { token22 } => {
                            self.model.recipient_tokens[h.recipient][usize::from(token22)] +=
                                h.amount;
                            prop_assert_eq!(
                                self.rent_payer_lamports(&h),
                                payer_before + rent_before,
                                "I6 vault rent"
                            );
                        }
                    }
                    self.model.released[h.recipient] += 1;
                    self.model.holds[index].status = status::RELEASED;
                }
                Ok(())
            }

            Op::Extend {
                hold,
                by,
                delta,
                tier,
            } => {
                let Some(index) = self.pick(hold, first) else {
                    return Ok(());
                };
                let h = self.model.holds[index].clone();
                let new_release_at = h.release_at + delta;
                // I3: oracle only, never shorter, never past max, tier never drops.
                let expect = by == Actor::Oracle
                    && h.status == status::PENDING
                    && now < h.release_at
                    && tier <= 4
                    && tier >= h.tier
                    && delta >= 0
                    && new_release_at <= h.created_at + i64::from(MAX_WINDOW);
                let key = self.signer(by, h.sender);
                let lamports_before = self.world.lamports(&h.address);
                let ix =
                    self.world
                        .ix_extend_window(&key.pubkey(), &h.address, new_release_at, tier);
                let ok = self.exec(ix, &key, expect, op)?;
                prop_assert_eq!(
                    self.world.lamports(&h.address),
                    lamports_before,
                    "I3 oracle moved lamports"
                );
                if ok {
                    self.model.holds[index].release_at = new_release_at;
                    self.model.holds[index].tier = tier;
                }
                let on_chain = self.world.hold(&h.address).expect("hold exists");
                prop_assert!(
                    on_chain.release_at >= h.release_at,
                    "I3 release_at went backwards"
                );
                prop_assert_eq!(on_chain.release_at, self.model.holds[index].release_at);
                prop_assert_eq!(on_chain.tier, self.model.holds[index].tier);
                Ok(())
            }

            Op::Close {
                hold,
                rent_to_attacker,
            } => {
                let Some(index) = self.pick(hold, first) else {
                    return Ok(());
                };
                let h = self.model.holds[index].clone();
                let expect = h.status != status::PENDING && !rent_to_attacker;
                let key = self.attacker.insecure_clone();
                let payer = if rent_to_attacker {
                    self.attacker.pubkey()
                } else {
                    self.rent_payer(&h)
                };
                let hold_rent = self.world.lamports(&h.address);
                let payer_before = self.rent_payer_lamports(&h);
                let ix = self.world.ix_close_hold(&key.pubkey(), &h.address, &payer);
                let ok = self.exec(ix, &key, expect, op)?;
                if ok {
                    prop_assert!(!self.world.exists(&h.address), "I6 hold still exists");
                    prop_assert_eq!(
                        self.rent_payer_lamports(&h),
                        payer_before + hold_rent,
                        "I6 hold rent"
                    );
                    self.model.holds[index].closed = true;
                }
                Ok(())
            }
        }
    }

    /// Sends one instruction and requires the outcome the model predicts.
    fn exec(
        &mut self,
        ix: solana_instruction::Instruction,
        signer: &Keypair,
        expect_ok: bool,
        op: &Op,
    ) -> Result<bool, TestCaseError> {
        self.executed += 1;
        let result = self.world.send(ix, &[signer]);
        prop_assert_eq!(
            result.is_ok(),
            expect_ok,
            "model expected ok={} for {:?}, program returned {:?}",
            expect_ok,
            op,
            result
        );
        Ok(expect_ok)
    }

    fn take_nonce(&mut self) -> u64 {
        let nonce = self.model.next_nonce;
        self.model.next_nonce += 1;
        nonce
    }

    /// Picks an open (not yet closed) hold created by the current case.
    fn pick(&self, selector: usize, first: usize) -> Option<usize> {
        let open: Vec<usize> = (first..self.model.holds.len())
            .filter(|&i| !self.model.holds[i].closed)
            .collect();
        if open.is_empty() {
            None
        } else {
            Some(open[selector % open.len()])
        }
    }

    fn rent_payer(&self, hold: &ModelHold) -> Address {
        if hold.from_box {
            self.world.relayer.pubkey()
        } else {
            self.senders[hold.sender].pubkey()
        }
    }

    fn rent_payer_lamports(&self, hold: &ModelHold) -> u64 {
        self.world.lamports(&self.rent_payer(hold))
    }

    /// I1, I2, I4, I5: every balance matches the model, the attacker holds
    /// nothing, and each mint's supply is fully accounted for.
    fn check_balances(&self, op: &Op) -> Result<(), TestCaseError> {
        let attacker = self.attacker.pubkey();
        prop_assert_eq!(
            self.world.lamports(&attacker),
            self.attacker_lamports,
            "attacker gained lamports after {:?}",
            op
        );

        for (m, token22) in [false, true].into_iter().enumerate() {
            let mint = self.mint(token22);
            let at = |owner: &Address| self.world.tokens(&ata(owner, &mint.mint, &mint.program));
            prop_assert_eq!(at(&attacker), 0, "attacker gained tokens after {:?}", op);

            let mut total = 0u128;
            for (i, sender) in self.senders.iter().enumerate() {
                let balance = at(&sender.pubkey());
                prop_assert_eq!(
                    balance,
                    self.model.sender_tokens[i][m],
                    "sender {} balance after {:?}",
                    i,
                    op
                );
                total += u128::from(balance);
            }
            for (i, recipient) in self.recipients.iter().enumerate() {
                let balance = at(recipient);
                prop_assert_eq!(
                    balance,
                    self.model.recipient_tokens[i][m],
                    "I2 recipient {} balance after {:?}",
                    i,
                    op
                );
                total += u128::from(balance);
            }
            if !token22 {
                let in_box = at(&box_pda(&self.senders[BOX_OWNER].pubkey()));
                prop_assert_eq!(in_box, self.model.box_tokens, "box balance after {:?}", op);
                total += u128::from(in_box);
            }
            for hold in self
                .model
                .holds
                .iter()
                .filter(|h| h.status == status::PENDING)
            {
                if hold.kind == (Kind::Token { token22 }) {
                    let in_vault = at(&hold.address);
                    prop_assert_eq!(in_vault, hold.amount, "vault balance after {:?}", op);
                    total += u128::from(in_vault);
                }
            }
            let supply = u128::from(START_TOKENS) * if token22 { 3 } else { 4 };
            prop_assert_eq!(total, supply, "I5 conservation after {:?}", op);
        }

        for (i, recipient) in self.recipients.iter().enumerate() {
            prop_assert_eq!(
                self.world.lamports(recipient),
                self.model.recipient_lamports[i],
                "I2 recipient {} lamports after {:?}",
                i,
                op
            );
        }
        Ok(())
    }

    /// I6: after the longest possible window every hold of the case can be
    /// released by a stranger and closed, leaving no account behind.
    fn settle_and_close(&mut self, first: usize) -> Result<(), TestCaseError> {
        self.world.warp(i64::from(MAX_WINDOW) + 1);
        let stranger = self.attacker.insecure_clone();
        for index in first..self.model.holds.len() {
            let h = self.model.holds[index].clone();
            if h.closed {
                continue;
            }
            if h.status == status::PENDING {
                let recipient = self.recipients[h.recipient];
                let ix = match h.kind {
                    Kind::Sol => {
                        self.world
                            .ix_release_sol(&stranger.pubkey(), &h.address, &recipient, false)
                    }
                    Kind::Token { .. } => {
                        self.world
                            .ix_release(&stranger.pubkey(), &h.address, &recipient, false)
                    }
                };
                self.executed += 1;
                let result = self.world.send(ix, &[&stranger]);
                prop_assert!(
                    result.is_ok(),
                    "I6 release after the window failed: {:?}",
                    result
                );
                match h.kind {
                    Kind::Sol => self.model.recipient_lamports[h.recipient] += h.amount,
                    Kind::Token { token22 } => {
                        self.model.recipient_tokens[h.recipient][usize::from(token22)] += h.amount
                    }
                }
                self.model.released[h.recipient] += 1;
                self.model.holds[index].status = status::RELEASED;
            }
            let payer = self.rent_payer(&h);
            let hold_rent = self.world.lamports(&h.address);
            let payer_before = self.world.lamports(&payer);
            let ix = self
                .world
                .ix_close_hold(&stranger.pubkey(), &h.address, &payer);
            self.executed += 1;
            let result = self.world.send(ix, &[&stranger]);
            prop_assert!(result.is_ok(), "I6 close failed: {:?}", result);
            prop_assert!(
                !self.world.exists(&h.address),
                "I6 hold account survived close"
            );
            prop_assert_eq!(
                self.world.lamports(&payer),
                payer_before + hold_rent,
                "I6 rent refund"
            );
            if let Kind::Token { token22 } = h.kind {
                let mint = self.mint(token22);
                prop_assert!(
                    !self
                        .world
                        .exists(&ata(&h.address, &mint.mint, &mint.program)),
                    "I6 vault survived"
                );
            }
            self.model.holds[index].closed = true;
        }
        self.check_balances(&Op::Warp { secs: 0 })
    }

    /// The on-chain reputation counters match the model.
    fn check_stats(&self) -> Result<(), TestCaseError> {
        for (i, recipient) in self.recipients.iter().enumerate() {
            let Some(stats) = self.world.stats(recipient) else {
                prop_assert_eq!(self.model.received[i], 0);
                continue;
            };
            prop_assert_eq!(
                stats.holds_received,
                self.model.received[i],
                "holds_received"
            );
            prop_assert_eq!(
                stats.holds_reclaimed_against,
                self.model.reclaimed[i],
                "holds_reclaimed_against"
            );
            prop_assert_eq!(
                stats.holds_released_to,
                self.model.released[i],
                "holds_released_to"
            );
        }
        Ok(())
    }
}

#[test]
fn random_instruction_sequences_never_break_an_invariant() {
    let cases: u32 = std::env::var("HOLDBACK_FUZZ_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2_000);

    let harness = RefCell::new(Harness::new());
    let mut runner = TestRunner::new(RunnerConfig {
        cases,
        failure_persistence: None,
        max_shrink_iters: 0,
        ..RunnerConfig::default()
    });

    let outcome = runner.run(&prop::collection::vec(op(), 1..=14), |ops| {
        harness.borrow_mut().run_case(&ops)
    });

    let harness = harness.into_inner();
    let violations = u32::from(outcome.is_err());
    println!(
        "invariant_cases={cases} instructions_executed={} holds_opened={} violations={violations}",
        harness.executed,
        harness.model.holds.len(),
    );
    if let Ok(path) = std::env::var("HOLDBACK_FUZZ_REPORT") {
        let report = format!(
            "{{\"invariant_cases\":{cases},\"instructions_executed\":{},\"holds_opened\":{},\"violations\":{violations}}}\n",
            harness.executed,
            harness.model.holds.len(),
        );
        std::fs::write(path, report).expect("write fuzz report");
    }
    if let Err(failure) = outcome {
        panic!("invariant violated: {failure}");
    }
}
