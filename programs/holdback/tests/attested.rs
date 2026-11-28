//! Attested holds: the window, tier and evidence hash carry the risk oracle's
//! Ed25519 signature, and the program checks it against the payment.

mod common;

use common::*;
use holdback::constants::{origin, tier};
use holdback::errors::HoldbackError as E;
use solana_signer::Signer;

const AMOUNT: u64 = 25_000_000;
const WINDOW: u32 = 21_600;

struct Setup {
    world: World,
    sender: solana_keypair::Keypair,
    recipient: solana_address::Address,
    expires_at: i64,
}

fn setup() -> Setup {
    let mut world = World::new();
    let sender = world.funded_keypair();
    let recipient = solana_address::Address::new_unique();
    let usdc = world.usdc;
    world.fund_tokens(&sender.pubkey(), usdc, 10 * AMOUNT);
    let expires_at = world.now() + 300;
    Setup {
        world,
        sender,
        recipient,
        expires_at,
    }
}

impl Setup {
    /// The oracle-signed assessment for a token hold of `amount`.
    fn signed(
        &self,
        signer: &solana_keypair::Keypair,
        amount: u64,
        window: u32,
        expires_at: i64,
    ) -> solana_instruction::Instruction {
        let message = World::assessment(
            &self.sender.pubkey(),
            &self.recipient,
            &self.world.usdc.mint,
            amount,
            window,
            tier::SUSPICIOUS,
            expires_at,
        );
        World::ix_ed25519(signer, &message)
    }

    fn hold(
        &self,
        nonce: u64,
        amount: u64,
        window: u32,
        attested: u32,
        expires_at: i64,
    ) -> solana_instruction::Instruction {
        self.world.ix_create_hold_attested(
            &self.sender.pubkey(),
            &self.recipient,
            self.world.usdc,
            nonce,
            amount,
            window,
            attested,
            tier::SUSPICIOUS,
            expires_at,
        )
    }
}

#[test]
fn an_oracle_signed_assessment_creates_an_attested_hold() {
    let mut s = setup();
    let oracle = s.world.oracle.insecure_clone();
    let sender = s.sender.insecure_clone();
    let ixs = [
        s.signed(&oracle, AMOUNT, WINDOW, s.expires_at),
        s.hold(1, AMOUNT, WINDOW, WINDOW, s.expires_at),
    ];
    s.world.send_all(&ixs, &[&sender]).unwrap();

    let hold = s.world.hold(&hold_pda(&sender.pubkey(), 1)).unwrap();
    assert_eq!(hold.origin, origin::ATTESTED);
    assert_eq!(hold.tier, tier::SUSPICIOUS);
    assert_eq!(hold.release_at - hold.created_at, i64::from(WINDOW));
    assert_eq!(hold.evidence_hash, [7u8; 32]);
}

#[test]
fn the_sender_may_lengthen_the_window_but_not_shorten_it() {
    let mut s = setup();
    let oracle = s.world.oracle.insecure_clone();
    let sender = s.sender.insecure_clone();
    let longer = [
        s.signed(&oracle, AMOUNT, WINDOW, s.expires_at),
        s.hold(1, AMOUNT, WINDOW + 3_600, WINDOW, s.expires_at),
    ];
    s.world.send_all(&longer, &[&sender]).unwrap();

    let shorter = [
        s.signed(&oracle, AMOUNT, WINDOW, s.expires_at),
        s.hold(2, AMOUNT, WINDOW - 1, WINDOW, s.expires_at),
    ];
    assert_eq!(
        s.world.send_all(&shorter, &[&sender]),
        Err(code(E::WindowTooShort))
    );
}

#[test]
fn a_signature_from_anyone_but_the_oracle_is_refused() {
    let mut s = setup();
    let impostor = s.world.funded_keypair();
    let sender = s.sender.insecure_clone();
    // The sender signs their own assessment with a short window.
    for signer in [&impostor, &sender] {
        let ixs = [
            s.signed(signer, AMOUNT, 60, s.expires_at),
            s.hold(1, AMOUNT, 60, 60, s.expires_at),
        ];
        assert_eq!(
            s.world.send_all(&ixs, &[&sender]),
            Err(code(E::WrongAttester))
        );
    }
}

#[test]
fn any_change_to_the_signed_terms_is_refused() {
    let mut s = setup();
    let oracle = s.world.oracle.insecure_clone();
    let sender = s.sender.insecure_clone();
    // Signed for 25 tokens, claimed for 26.
    let amount = [
        s.signed(&oracle, AMOUNT, WINDOW, s.expires_at),
        s.hold(1, AMOUNT + 1, WINDOW, WINDOW, s.expires_at),
    ];
    assert_eq!(
        s.world.send_all(&amount, &[&sender]),
        Err(code(E::AttestationMismatch))
    );
    // Signed for a 6-hour window, claimed as a 30-minute one.
    let window = [
        s.signed(&oracle, AMOUNT, WINDOW, s.expires_at),
        s.hold(1, AMOUNT, 1_800, 1_800, s.expires_at),
    ];
    assert_eq!(
        s.world.send_all(&window, &[&sender]),
        Err(code(E::AttestationMismatch))
    );
    // Signed expiry stretched by the sender.
    let expiry = [
        s.signed(&oracle, AMOUNT, WINDOW, s.expires_at),
        s.hold(1, AMOUNT, WINDOW, WINDOW, s.expires_at + 3_600),
    ];
    assert_eq!(
        s.world.send_all(&expiry, &[&sender]),
        Err(code(E::AttestationMismatch))
    );
}

#[test]
fn an_expired_assessment_is_refused() {
    let mut s = setup();
    let oracle = s.world.oracle.insecure_clone();
    let sender = s.sender.insecure_clone();
    let ixs = [
        s.signed(&oracle, AMOUNT, WINDOW, s.expires_at),
        s.hold(1, AMOUNT, WINDOW, WINDOW, s.expires_at),
    ];
    s.world.warp(301);
    assert_eq!(
        s.world.send_all(&ixs, &[&sender]),
        Err(code(E::AttestationExpired))
    );
}

#[test]
fn without_the_signature_instruction_the_hold_is_refused() {
    let mut s = setup();
    let sender = s.sender.insecure_clone();
    let ix = s.hold(1, AMOUNT, WINDOW, WINDOW, s.expires_at);
    assert_eq!(
        s.world.send(ix, &[&sender]),
        Err(code(E::MissingAttestation))
    );
}

#[test]
fn attested_sol_holds_work_the_same_way() {
    let mut world = World::new();
    let sender = world.funded_keypair();
    let recipient = solana_address::Address::new_unique();
    let oracle = world.oracle.insecure_clone();
    let expires_at = world.now() + 300;
    let sol = solana_address::Address::new_from_array([0u8; 32]);
    let message = World::assessment(
        &sender.pubkey(),
        &recipient,
        &sol,
        LAMPORTS,
        WINDOW,
        tier::SUSPICIOUS,
        expires_at,
    );
    let ixs = [
        World::ix_ed25519(&oracle, &message),
        world.ix_create_hold_sol_attested(
            &sender.pubkey(),
            &recipient,
            1,
            LAMPORTS,
            WINDOW,
            WINDOW,
            tier::SUSPICIOUS,
            expires_at,
        ),
    ];
    world.send_all(&ixs, &[&sender]).unwrap();
    assert_eq!(
        world.hold(&hold_pda(&sender.pubkey(), 1)).unwrap().origin,
        origin::ATTESTED
    );
}
