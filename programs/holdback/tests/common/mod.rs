//! Shared LiteSVM harness: a loaded program, funded parties, both token
//! programs, a warpable clock and one builder per instruction.

#![allow(dead_code)]

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use holdback::constants::*;
use holdback::state::{Config, Hold, SubjectStats};
use litesvm::types::FailedTransactionMetadata;
use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_instruction_error::InstructionError;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

pub const TOKEN_PROGRAM: Address =
    Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM: Address =
    Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ATA_PROGRAM: Address =
    Address::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const SYSTEM_PROGRAM: Address = Address::from_str_const("11111111111111111111111111111111");
pub const LOADER_V3: Address =
    Address::from_str_const("BPFLoaderUpgradeab1e11111111111111111111111");

pub const MIN_WINDOW: u32 = 0;
pub const DEFAULT_WINDOW: u32 = 1_800;
pub const MAX_WINDOW: u32 = 259_200;
pub const DECIMALS: u8 = 6;
pub const LAMPORTS: u64 = 1_000_000_000;

/// Why a transaction failed, reduced to what the tests assert on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failure {
    /// A program error code (Anchor or HOLDBACK).
    Code(u32),
    /// Anything else (missing signature, insufficient funds, ...).
    Other(String),
}

pub fn code(err: holdback::errors::HoldbackError) -> Failure {
    Failure::Code(u32::from(err))
}

pub fn pk(a: &Address) -> Pubkey {
    Pubkey::new_from_array(a.to_bytes())
}

pub fn addr(p: &Pubkey) -> Address {
    Address::new_from_array(p.to_bytes())
}

pub fn program_id() -> Address {
    addr(&holdback::ID)
}

fn pda(seeds: &[&[u8]]) -> Address {
    Address::find_program_address(seeds, &program_id()).0
}

pub fn config_pda() -> Address {
    pda(&[CONFIG_SEED])
}

pub fn hold_pda(sender: &Address, nonce: u64) -> Address {
    pda(&[HOLD_SEED, sender.as_ref(), &nonce.to_le_bytes()])
}

pub fn trust_pda(sender: &Address, recipient: &Address) -> Address {
    pda(&[TRUST_SEED, sender.as_ref(), recipient.as_ref()])
}

pub fn box_pda(owner: &Address) -> Address {
    pda(&[BOX_SEED, owner.as_ref()])
}

pub fn flag_pda(reporter: &Address, subject: &Address) -> Address {
    pda(&[FLAG_SEED, reporter.as_ref(), subject.as_ref()])
}

pub fn stats_pda(subject: &Address) -> Address {
    pda(&[STATS_SEED, subject.as_ref()])
}

pub fn ata(owner: &Address, mint: &Address, token_program: &Address) -> Address {
    Address::find_program_address(
        &[owner.as_ref(), token_program.as_ref(), mint.as_ref()],
        &ATA_PROGRAM,
    )
    .0
}

/// A mint together with the token program that owns it.
#[derive(Clone, Copy, Debug)]
pub struct MintRef {
    pub mint: Address,
    pub program: Address,
}

pub struct World {
    pub svm: LiteSVM,
    pub fee_payer: Keypair,
    pub admin: Keypair,
    pub oracle: Keypair,
    pub relayer: Keypair,
    /// A classic SPL Token mint.
    pub usdc: MintRef,
    /// A Token-2022 mint without extensions.
    pub token22: MintRef,
}

impl World {
    /// Loads the compiled program, makes `admin` its upgrade authority and
    /// initializes the config with the production window settings.
    pub fn new() -> Self {
        let mut world = Self::without_config();
        let ix = world.ix_initialize_config(
            &world.admin.pubkey(),
            MIN_WINDOW,
            DEFAULT_WINDOW,
            MAX_WINDOW,
        );
        let admin = world.admin.insecure_clone();
        world.send(ix, &[&admin]).expect("initialize_config");
        world
    }

    pub fn without_config() -> Self {
        let mut svm = LiteSVM::new()
            .with_precompiles()
            .with_sigverify(false)
            .with_blockhash_check(false)
            .with_transaction_history(0);

        let so = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../target/deploy/holdback.so"
        );
        let bytes = std::fs::read(so).expect("run `anchor build` before the Rust tests");
        svm.add_program(program_id(), &bytes).expect("load program");

        let fee_payer = Keypair::new();
        let admin = Keypair::new();
        let oracle = Keypair::new();
        let relayer = Keypair::new();
        for key in [&fee_payer, &admin, &oracle, &relayer] {
            svm.airdrop(&key.pubkey(), 1_000 * LAMPORTS).unwrap();
        }

        // LiteSVM loads programs with no upgrade authority. Write the admin
        // into the ProgramData header: u32 tag, u64 slot, Option<Pubkey>.
        let program_data = Address::find_program_address(&[program_id().as_ref()], &LOADER_V3).0;
        let mut account = svm.get_account(&program_data).expect("program data");
        account.data[12] = 1;
        account.data[13..45].copy_from_slice(admin.pubkey().as_ref());
        svm.set_account(program_data, account).unwrap();

        let mut world = Self {
            svm,
            fee_payer,
            admin,
            oracle,
            relayer,
            usdc: MintRef {
                mint: Address::default(),
                program: TOKEN_PROGRAM,
            },
            token22: MintRef {
                mint: Address::default(),
                program: TOKEN_2022_PROGRAM,
            },
        };
        world.usdc = world.create_mint(TOKEN_PROGRAM);
        world.token22 = world.create_mint(TOKEN_2022_PROGRAM);

        let mut clock: Clock = world.svm.get_sysvar();
        clock.unix_timestamp = 1_800_000_000;
        world.svm.set_sysvar(&clock);
        world
    }

    // ---- accounts and clock -------------------------------------------------

    pub fn funded_keypair(&mut self) -> Keypair {
        let key = Keypair::new();
        self.svm.airdrop(&key.pubkey(), 1_000 * LAMPORTS).unwrap();
        key
    }

    pub fn create_mint(&mut self, token_program: Address) -> MintRef {
        let mint = Address::new_unique();
        let mut data = vec![0u8; 82];
        data[0..4].copy_from_slice(&1u32.to_le_bytes());
        data[4..36].copy_from_slice(self.admin.pubkey().as_ref());
        data[36..44].copy_from_slice(&u64::MAX.to_le_bytes());
        data[44] = DECIMALS;
        data[45] = 1;
        self.set_raw(mint, token_program, data);
        MintRef {
            mint,
            program: token_program,
        }
    }

    /// Creates (or overwrites) `owner`'s associated token account with
    /// `amount` tokens and returns its address.
    pub fn fund_tokens(&mut self, owner: &Address, mint: MintRef, amount: u64) -> Address {
        let address = ata(owner, &mint.mint, &mint.program);
        let mut data = vec![0u8; 165];
        data[0..32].copy_from_slice(mint.mint.as_ref());
        data[32..64].copy_from_slice(owner.as_ref());
        data[64..72].copy_from_slice(&amount.to_le_bytes());
        data[108] = 1;
        self.set_raw(address, mint.program, data);
        address
    }

    fn set_raw(&mut self, address: Address, owner: Address, data: Vec<u8>) {
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        self.svm
            .set_account(
                address,
                Account {
                    lamports,
                    data,
                    owner,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn warp(&mut self, secs: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp += secs;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
    }

    pub fn warp_to(&mut self, unix_timestamp: i64) {
        let delta = unix_timestamp - self.now();
        self.warp(delta);
    }

    pub fn lamports(&self, address: &Address) -> u64 {
        self.svm.get_balance(address).unwrap_or(0)
    }

    pub fn exists(&self, address: &Address) -> bool {
        self.svm
            .get_account(address)
            .is_some_and(|a| a.lamports > 0 && !a.data.is_empty())
    }

    pub fn tokens(&self, token_account: &Address) -> u64 {
        match self.svm.get_account(token_account) {
            Some(a) if a.data.len() >= 72 => u64::from_le_bytes(a.data[64..72].try_into().unwrap()),
            _ => 0,
        }
    }

    pub fn hold(&self, address: &Address) -> Option<Hold> {
        let account = self.svm.get_account(address)?;
        Hold::try_deserialize(&mut account.data.as_slice()).ok()
    }

    pub fn stats(&self, subject: &Address) -> Option<SubjectStats> {
        let account = self.svm.get_account(&stats_pda(subject))?;
        SubjectStats::try_deserialize(&mut account.data.as_slice()).ok()
    }

    pub fn config(&self) -> Config {
        let account = self.svm.get_account(&config_pda()).expect("config");
        Config::try_deserialize(&mut account.data.as_slice()).expect("config layout")
    }

    // ---- sending --------------------------------------------------------------

    pub fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<(), Failure> {
        self.send_all(&[ix], signers)
    }

    /// Sends several instructions in one transaction.
    pub fn send_all(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), Failure> {
        let mut all: Vec<&Keypair> = vec![&self.fee_payer];
        all.extend_from_slice(signers);
        let message = Message::new(ixs, Some(&self.fee_payer.pubkey()));
        let tx = Transaction::new(&all, message, self.svm.latest_blockhash());
        self.svm.send_transaction(tx).map(|_| ()).map_err(reduce)
    }

    // ---- instruction builders ----------------------------------------------------

    pub fn ix_initialize_config(
        &self,
        admin: &Address,
        min: u32,
        default: u32,
        max: u32,
    ) -> Instruction {
        let program_data = Address::find_program_address(&[program_id().as_ref()], &LOADER_V3).0;
        build(
            holdback::accounts::InitializeConfig {
                admin: pk(admin),
                config: pk(&config_pda()),
                program: holdback::ID,
                program_data: pk(&program_data),
                system_program: pk(&SYSTEM_PROGRAM),
            },
            holdback::instruction::InitializeConfig {
                relayer: pk(&self.relayer.pubkey()),
                risk_oracle: pk(&self.oracle.pubkey()),
                min_window_secs: min,
                default_window_secs: default,
                max_window_secs: max,
            },
        )
    }

    pub fn ix_update_config(
        &self,
        admin: &Address,
        args: holdback::instructions::UpdateConfigArgs,
    ) -> Instruction {
        build(
            holdback::accounts::UpdateConfig {
                admin: pk(admin),
                config: pk(&config_pda()),
            },
            holdback::instruction::UpdateConfig { args },
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn ix_create_hold(
        &self,
        sender: &Address,
        recipient: &Address,
        mint: MintRef,
        nonce: u64,
        amount: u64,
        window_secs: u32,
        tier: u8,
    ) -> Instruction {
        let hold = hold_pda(sender, nonce);
        build(
            holdback::accounts::CreateHold {
                sender: pk(sender),
                recipient: pk(recipient),
                config: pk(&config_pda()),
                mint: pk(&mint.mint),
                sender_token: pk(&ata(sender, &mint.mint, &mint.program)),
                hold: pk(&hold),
                vault: pk(&ata(&hold, &mint.mint, &mint.program)),
                recipient_stats: pk(&stats_pda(recipient)),
                token_program: pk(&mint.program),
                associated_token_program: pk(&ATA_PROGRAM),
                system_program: pk(&SYSTEM_PROGRAM),
            },
            holdback::instruction::CreateHold {
                nonce,
                amount,
                window_secs,
                tier,
                evidence_hash: [7u8; 32],
            },
        )
    }

    /// The Ed25519 program instruction that carries `signer`'s signature over
    /// `message`, in the single-instruction layout clients produce.
    pub fn ix_ed25519(signer: &Keypair, message: &[u8]) -> Instruction {
        let signature = signer.sign_message(message);
        let key_offset = 16u16;
        let sig_offset = key_offset + 32;
        let msg_offset = sig_offset + 64;
        let mut data = vec![1u8, 0];
        for v in [
            sig_offset,
            u16::MAX,
            key_offset,
            u16::MAX,
            msg_offset,
            message.len() as u16,
            u16::MAX,
        ] {
            data.extend_from_slice(&v.to_le_bytes());
        }
        data.extend_from_slice(signer.pubkey().as_ref());
        data.extend_from_slice(signature.as_ref());
        data.extend_from_slice(message);
        Instruction {
            program_id: Address::from_str_const("Ed25519SigVerify111111111111111111111111111"),
            accounts: vec![],
            data,
        }
    }

    /// The assessment bytes the oracle signs.
    #[allow(clippy::too_many_arguments)]
    pub fn assessment(
        sender: &Address,
        recipient: &Address,
        mint: &Address,
        amount: u64,
        window_secs: u32,
        tier: u8,
        expires_at: i64,
    ) -> Vec<u8> {
        holdback::instructions::Assessment {
            sender: pk(sender),
            recipient: pk(recipient),
            mint: pk(mint),
            amount,
            window_secs,
            tier,
            evidence_hash: [7u8; 32],
            expires_at,
        }
        .message(&holdback::ID)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn ix_create_hold_attested(
        &self,
        sender: &Address,
        recipient: &Address,
        mint: MintRef,
        nonce: u64,
        amount: u64,
        window_secs: u32,
        attested_window_secs: u32,
        tier: u8,
        expires_at: i64,
    ) -> Instruction {
        let hold = hold_pda(sender, nonce);
        build(
            holdback::accounts::CreateHoldAttested {
                base: holdback::accounts::CreateHold {
                    sender: pk(sender),
                    recipient: pk(recipient),
                    config: pk(&config_pda()),
                    mint: pk(&mint.mint),
                    sender_token: pk(&ata(sender, &mint.mint, &mint.program)),
                    hold: pk(&hold),
                    vault: pk(&ata(&hold, &mint.mint, &mint.program)),
                    recipient_stats: pk(&stats_pda(recipient)),
                    token_program: pk(&mint.program),
                    associated_token_program: pk(&ATA_PROGRAM),
                    system_program: pk(&SYSTEM_PROGRAM),
                },
                instructions: pk(&Address::from_str_const(
                    "Sysvar1nstructions1111111111111111111111111",
                )),
            },
            holdback::instruction::CreateHoldAttested {
                nonce,
                amount,
                window_secs,
                attested_window_secs,
                tier,
                evidence_hash: [7u8; 32],
                expires_at,
            },
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn ix_create_hold_sol_attested(
        &self,
        sender: &Address,
        recipient: &Address,
        nonce: u64,
        amount: u64,
        window_secs: u32,
        attested_window_secs: u32,
        tier: u8,
        expires_at: i64,
    ) -> Instruction {
        build(
            holdback::accounts::CreateHoldSolAttested {
                base: holdback::accounts::CreateHoldSol {
                    sender: pk(sender),
                    recipient: pk(recipient),
                    config: pk(&config_pda()),
                    hold: pk(&hold_pda(sender, nonce)),
                    recipient_stats: pk(&stats_pda(recipient)),
                    system_program: pk(&SYSTEM_PROGRAM),
                },
                instructions: pk(&Address::from_str_const(
                    "Sysvar1nstructions1111111111111111111111111",
                )),
            },
            holdback::instruction::CreateHoldSolAttested {
                nonce,
                amount,
                window_secs,
                attested_window_secs,
                tier,
                evidence_hash: [7u8; 32],
                expires_at,
            },
        )
    }

    pub fn ix_create_hold_sol(
        &self,
        sender: &Address,
        recipient: &Address,
        nonce: u64,
        amount: u64,
        window_secs: u32,
        tier: u8,
    ) -> Instruction {
        build(
            holdback::accounts::CreateHoldSol {
                sender: pk(sender),
                recipient: pk(recipient),
                config: pk(&config_pda()),
                hold: pk(&hold_pda(sender, nonce)),
                recipient_stats: pk(&stats_pda(recipient)),
                system_program: pk(&SYSTEM_PROGRAM),
            },
            holdback::instruction::CreateHoldSol {
                nonce,
                amount,
                window_secs,
                tier,
                evidence_hash: [7u8; 32],
            },
        )
    }

    pub fn ix_instant_transfer(
        &self,
        sender: &Address,
        recipient: &Address,
        mint: MintRef,
        amount: u64,
    ) -> Instruction {
        build(
            holdback::accounts::InstantTransferToken {
                sender: pk(sender),
                recipient: pk(recipient),
                config: pk(&config_pda()),
                trust: pk(&trust_pda(sender, recipient)),
                mint: pk(&mint.mint),
                sender_token: pk(&ata(sender, &mint.mint, &mint.program)),
                recipient_token: pk(&ata(recipient, &mint.mint, &mint.program)),
                recipient_stats: pk(&stats_pda(recipient)),
                token_program: pk(&mint.program),
                associated_token_program: pk(&ATA_PROGRAM),
                system_program: pk(&SYSTEM_PROGRAM),
            },
            holdback::instruction::InstantTransfer { amount },
        )
    }

    pub fn ix_instant_transfer_sol(
        &self,
        sender: &Address,
        recipient: &Address,
        amount: u64,
    ) -> Instruction {
        build(
            holdback::accounts::InstantTransferSol {
                sender: pk(sender),
                recipient: pk(recipient),
                config: pk(&config_pda()),
                trust: pk(&trust_pda(sender, recipient)),
                recipient_stats: pk(&stats_pda(recipient)),
                system_program: pk(&SYSTEM_PROGRAM),
            },
            holdback::instruction::InstantTransferSol { amount },
        )
    }

    pub fn ix_init_deposit_box(
        &self,
        payer: &Address,
        owner: &Address,
        mint: MintRef,
    ) -> Instruction {
        let deposit_box = box_pda(owner);
        build(
            holdback::accounts::InitDepositBox {
                payer: pk(payer),
                owner: pk(owner),
                deposit_box: pk(&deposit_box),
                mint: pk(&mint.mint),
                box_token: pk(&ata(&deposit_box, &mint.mint, &mint.program)),
                token_program: pk(&mint.program),
                associated_token_program: pk(&ATA_PROGRAM),
                system_program: pk(&SYSTEM_PROGRAM),
            },
            holdback::instruction::InitDepositBox {},
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn ix_open_hold_from_deposit(
        &self,
        signer: &Address,
        owner: &Address,
        recipient: &Address,
        mint: MintRef,
        nonce: u64,
        amount: u64,
        window_secs: u32,
        tier: u8,
    ) -> Instruction {
        let deposit_box = box_pda(owner);
        let hold = hold_pda(owner, nonce);
        build(
            holdback::accounts::OpenHoldFromDeposit {
                relayer: pk(signer),
                config: pk(&config_pda()),
                deposit_box: pk(&deposit_box),
                recipient: pk(recipient),
                mint: pk(&mint.mint),
                box_token: pk(&ata(&deposit_box, &mint.mint, &mint.program)),
                hold: pk(&hold),
                vault: pk(&ata(&hold, &mint.mint, &mint.program)),
                recipient_stats: pk(&stats_pda(recipient)),
                token_program: pk(&mint.program),
                associated_token_program: pk(&ATA_PROGRAM),
                system_program: pk(&SYSTEM_PROGRAM),
            },
            holdback::instruction::OpenHoldFromDeposit {
                nonce,
                amount,
                window_secs,
                tier,
                evidence_hash: [9u8; 32],
            },
        )
    }

    /// `destination` is the token account that should receive the funds; a
    /// correct client passes the owner's, an attacker passes their own.
    pub fn ix_withdraw_deposit(
        &self,
        signer: &Address,
        owner: &Address,
        mint: MintRef,
        destination: &Address,
        amount: u64,
    ) -> Instruction {
        let deposit_box = box_pda(owner);
        build(
            holdback::accounts::WithdrawDeposit {
                authority: pk(signer),
                config: pk(&config_pda()),
                deposit_box: pk(&deposit_box),
                mint: pk(&mint.mint),
                box_token: pk(&ata(&deposit_box, &mint.mint, &mint.program)),
                owner_token: pk(destination),
                token_program: pk(&mint.program),
            },
            holdback::instruction::WithdrawDeposit { amount },
        )
    }

    pub fn ix_extend_window(
        &self,
        signer: &Address,
        hold: &Address,
        new_release_at: i64,
        tier: u8,
    ) -> Instruction {
        build(
            holdback::accounts::ExtendWindow {
                risk_oracle: pk(signer),
                config: pk(&config_pda()),
                hold: pk(hold),
            },
            holdback::instruction::ExtendWindow {
                new_release_at,
                tier,
                evidence_hash: [8u8; 32],
            },
        )
    }

    /// Token reclaim. `destination` is the refund token account.
    pub fn ix_reclaim(
        &self,
        signer: &Address,
        hold: &Address,
        destination: &Address,
    ) -> Instruction {
        let state = self.hold(hold).expect("hold exists");
        let mint = self.mint_ref(&addr(&state.mint));
        build(
            holdback::accounts::Reclaim {
                authority: pk(signer),
                config: pk(&config_pda()),
                hold: pk(hold),
                mint: state.mint,
                vault: pk(&ata(hold, &mint.mint, &mint.program)),
                sender_token: pk(destination),
                rent_payer: state.rent_payer,
                recipient_stats: pk(&stats_pda(&addr(&state.recipient))),
                token_program: pk(&mint.program),
            },
            holdback::instruction::Reclaim {},
        )
    }

    pub fn ix_reclaim_sol(
        &self,
        signer: &Address,
        hold: &Address,
        destination: &Address,
    ) -> Instruction {
        let state = self.hold(hold).expect("hold exists");
        build(
            holdback::accounts::ReclaimSol {
                authority: pk(signer),
                config: pk(&config_pda()),
                hold: pk(hold),
                sender: pk(destination),
                recipient_stats: pk(&stats_pda(&addr(&state.recipient))),
            },
            holdback::instruction::ReclaimSol {},
        )
    }

    /// Token release. `recipient` is who the caller claims should be paid.
    pub fn ix_release(
        &self,
        caller: &Address,
        hold: &Address,
        recipient: &Address,
        early: bool,
    ) -> Instruction {
        let state = self.hold(hold).expect("hold exists");
        let mint = self.mint_ref(&addr(&state.mint));
        let accounts = holdback::accounts::Release {
            caller: pk(caller),
            hold: pk(hold),
            mint: state.mint,
            vault: pk(&ata(hold, &mint.mint, &mint.program)),
            recipient: pk(recipient),
            recipient_token: pk(&ata(recipient, &mint.mint, &mint.program)),
            rent_payer: state.rent_payer,
            recipient_stats: pk(&stats_pda(&addr(&state.recipient))),
            token_program: pk(&mint.program),
            associated_token_program: pk(&ATA_PROGRAM),
            system_program: pk(&SYSTEM_PROGRAM),
        };
        if early {
            build(accounts, holdback::instruction::ReleaseEarly {})
        } else {
            build(accounts, holdback::instruction::Release {})
        }
    }

    pub fn ix_release_sol(
        &self,
        caller: &Address,
        hold: &Address,
        recipient: &Address,
        early: bool,
    ) -> Instruction {
        let state = self.hold(hold).expect("hold exists");
        let accounts = holdback::accounts::ReleaseSol {
            caller: pk(caller),
            hold: pk(hold),
            recipient: pk(recipient),
            recipient_stats: pk(&stats_pda(&addr(&state.recipient))),
        };
        if early {
            build(accounts, holdback::instruction::ReleaseEarlySol {})
        } else {
            build(accounts, holdback::instruction::ReleaseSol {})
        }
    }

    pub fn ix_set_trust(&self, sender: &Address, recipient: &Address) -> Instruction {
        build(
            holdback::accounts::SetTrust {
                sender: pk(sender),
                recipient: pk(recipient),
                trust: pk(&trust_pda(sender, recipient)),
                system_program: pk(&SYSTEM_PROGRAM),
            },
            holdback::instruction::SetTrust {},
        )
    }

    pub fn ix_remove_trust(&self, sender: &Address, recipient: &Address) -> Instruction {
        build(
            holdback::accounts::RemoveTrust {
                sender: pk(sender),
                recipient: pk(recipient),
                trust: pk(&trust_pda(sender, recipient)),
            },
            holdback::instruction::RemoveTrust {},
        )
    }

    pub fn ix_flag_subject(
        &self,
        reporter: &Address,
        subject: &Address,
        reason: u8,
    ) -> Instruction {
        build(
            holdback::accounts::FlagSubject {
                reporter: pk(reporter),
                subject: pk(subject),
                flag: pk(&flag_pda(reporter, subject)),
                subject_stats: pk(&stats_pda(subject)),
                system_program: pk(&SYSTEM_PROGRAM),
            },
            holdback::instruction::FlagSubject {
                reason,
                evidence_hash: [5u8; 32],
            },
        )
    }

    pub fn ix_close_hold(
        &self,
        caller: &Address,
        hold: &Address,
        rent_payer: &Address,
    ) -> Instruction {
        build(
            holdback::accounts::CloseHold {
                caller: pk(caller),
                hold: pk(hold),
                rent_payer: pk(rent_payer),
            },
            holdback::instruction::CloseHold {},
        )
    }

    pub fn mint_ref(&self, mint: &Address) -> MintRef {
        if *mint == self.token22.mint {
            self.token22
        } else {
            self.usdc
        }
    }
}

fn build<A: ToAccountMetas, D: InstructionData>(accounts: A, data: D) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: accounts
            .to_account_metas(None)
            .into_iter()
            .map(|meta| AccountMeta {
                pubkey: addr(&meta.pubkey),
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            })
            .collect(),
        data: data.data(),
    }
}

fn reduce(failure: FailedTransactionMetadata) -> Failure {
    match failure.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => {
            if std::env::var("HOLDBACK_DEBUG_LOGS").is_ok() {
                eprintln!("{}", failure.meta.logs.join("\n"));
            }
            Failure::Code(code)
        }
        other => Failure::Other(format!("{other:?} | {}", failure.meta.logs.join(" | "))),
    }
}
