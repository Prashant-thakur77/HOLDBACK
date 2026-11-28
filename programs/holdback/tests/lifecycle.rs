//! Deterministic tests for every instruction, with clock warping to hit the
//! exact boundary second of a window.

mod common;

use common::*;
use holdback::constants::{origin, status, tier, NATIVE_SOL_MINT};
use holdback::errors::HoldbackError as E;
use holdback::instructions::UpdateConfigArgs;
use solana_signer::Signer;

const AMOUNT: u64 = 25_000_000; // 25 tokens at 6 decimals
const WINDOW: u32 = 1_800;

/// A sender with tokens, a recipient, and one pending token hold.
struct Scene {
    world: World,
    sender: solana_keypair::Keypair,
    recipient: solana_address::Address,
    hold: solana_address::Address,
    sender_token: solana_address::Address,
    created_at: i64,
}

fn scene(mint: fn(&World) -> MintRef) -> Scene {
    let mut world = World::new();
    let sender = world.funded_keypair();
    let recipient = solana_address::Address::new_unique();
    let mint = mint(&world);
    let sender_token = world.fund_tokens(&sender.pubkey(), mint, 100 * AMOUNT);
    let created_at = world.now();
    let ix = world.ix_create_hold(
        &sender.pubkey(),
        &recipient,
        mint,
        1,
        AMOUNT,
        WINDOW,
        tier::UNKNOWN,
    );
    world.send(ix, &[&sender]).expect("create_hold");
    let hold = hold_pda(&sender.pubkey(), 1);
    Scene {
        world,
        sender,
        recipient,
        hold,
        sender_token,
        created_at,
    }
}

fn usdc(world: &World) -> MintRef {
    world.usdc
}

fn token22(world: &World) -> MintRef {
    world.token22
}

// ---- config ---------------------------------------------------------------------

#[test]
fn config_can_only_be_initialized_by_the_upgrade_authority() {
    let mut world = World::without_config();
    let attacker = world.funded_keypair();

    let ix = world.ix_initialize_config(&attacker.pubkey(), 0, 1_800, 259_200);
    assert_eq!(world.send(ix, &[&attacker]), Err(code(E::Unauthorized)));

    let admin = world.admin.insecure_clone();
    let ix = world.ix_initialize_config(&admin.pubkey(), 0, 1_800, 259_200);
    world.send(ix, &[&admin]).unwrap();

    let config = world.config();
    assert_eq!(addr(&config.admin), admin.pubkey());
    assert_eq!(addr(&config.relayer), world.relayer.pubkey());
    assert_eq!(addr(&config.risk_oracle), world.oracle.pubkey());
    assert_eq!(
        (
            config.min_window_secs,
            config.default_window_secs,
            config.max_window_secs
        ),
        (0, 1_800, 259_200)
    );
    assert!(!config.paused);

    // `init` refuses a second initialization.
    let ix = world.ix_initialize_config(&admin.pubkey(), 0, 60, 120);
    assert!(world.send(ix, &[&admin]).is_err());
}

#[test]
fn config_rejects_inconsistent_windows() {
    let mut world = World::without_config();
    let admin = world.admin.insecure_clone();
    for (min, default, max) in [(10, 5, 100), (0, 200, 100), (0, 0, 0), (0, 60, 31 * 86_400)] {
        let ix = world.ix_initialize_config(&admin.pubkey(), min, default, max);
        assert_eq!(world.send(ix, &[&admin]), Err(code(E::InvalidWindowConfig)));
    }
}

#[test]
fn only_the_admin_updates_config() {
    let mut world = World::new();
    let attacker = world.funded_keypair();
    let args = UpdateConfigArgs {
        paused: Some(true),
        ..Default::default()
    };

    let ix = world.ix_update_config(&attacker.pubkey(), args.clone());
    assert_eq!(world.send(ix, &[&attacker]), Err(code(E::Unauthorized)));

    let admin = world.admin.insecure_clone();
    let ix = world.ix_update_config(&admin.pubkey(), args);
    world.send(ix, &[&admin]).unwrap();
    assert!(world.config().paused);

    let bad = UpdateConfigArgs {
        max_window_secs: Some(10),
        ..Default::default()
    };
    let ix = world.ix_update_config(&admin.pubkey(), bad);
    assert_eq!(world.send(ix, &[&admin]), Err(code(E::InvalidWindowConfig)));
}

// ---- create ---------------------------------------------------------------------

#[test]
fn create_hold_moves_tokens_into_the_vault_and_records_everything() {
    let s = scene(usdc);
    let hold = s.world.hold(&s.hold).unwrap();
    assert_eq!(addr(&hold.sender), s.sender.pubkey());
    assert_eq!(addr(&hold.recipient), s.recipient);
    assert_eq!(addr(&hold.mint), s.world.usdc.mint);
    assert_eq!(hold.amount, AMOUNT);
    assert_eq!(hold.created_at, s.created_at);
    assert_eq!(hold.release_at, s.created_at + i64::from(WINDOW));
    assert_eq!(hold.tier, tier::UNKNOWN);
    assert_eq!(hold.origin, origin::WALLET);
    assert_eq!(hold.status, status::PENDING);
    assert_eq!(addr(&hold.rent_payer), s.sender.pubkey());
    assert_eq!(hold.evidence_hash, [7u8; 32]);

    let vault = ata(&s.hold, &s.world.usdc.mint, &s.world.usdc.program);
    assert_eq!(s.world.tokens(&vault), AMOUNT);
    assert_eq!(s.world.tokens(&s.sender_token), 99 * AMOUNT);
    assert_eq!(s.world.stats(&s.recipient).unwrap().holds_received, 1);
}

#[test]
fn create_hold_validates_amount_window_tier_and_parties() {
    let mut world = World::new();
    let sender = world.funded_keypair();
    let recipient = solana_address::Address::new_unique();
    let mint = world.usdc;
    world.fund_tokens(&sender.pubkey(), mint, AMOUNT);
    let me = sender.pubkey();

    let cases = [
        (
            world.ix_create_hold(&me, &recipient, mint, 1, 0, WINDOW, 1),
            E::ZeroAmount,
        ),
        (
            world.ix_create_hold(&me, &recipient, mint, 1, 1, 0, 1),
            E::WindowTooShort,
        ),
        (
            world.ix_create_hold(&me, &recipient, mint, 1, 1, MAX_WINDOW + 1, 1),
            E::WindowTooLong,
        ),
        (
            world.ix_create_hold(&me, &recipient, mint, 1, 1, WINDOW, 5),
            E::InvalidTier,
        ),
        (
            world.ix_create_hold(&me, &me, mint, 1, 1, WINDOW, 1),
            E::SelfTransfer,
        ),
    ];
    for (ix, expected) in cases {
        assert_eq!(world.send(ix, &[&sender]), Err(code(expected)));
    }

    // More than the sender owns: the token program refuses the transfer.
    let ix = world.ix_create_hold(&me, &recipient, mint, 1, AMOUNT + 1, WINDOW, 1);
    assert!(world.send(ix, &[&sender]).is_err());

    // The same nonce cannot be used twice.
    let ix = world.ix_create_hold(&me, &recipient, mint, 1, 1, WINDOW, 1);
    world.send(ix, &[&sender]).unwrap();
    let ix = world.ix_create_hold(&me, &recipient, mint, 1, 1, WINDOW, 1);
    assert!(world.send(ix, &[&sender]).is_err());
}

#[test]
fn create_hold_respects_a_raised_minimum_window() {
    let mut world = World::new();
    let admin = world.admin.insecure_clone();
    let args = UpdateConfigArgs {
        min_window_secs: Some(600),
        ..Default::default()
    };
    let ix = world.ix_update_config(&admin.pubkey(), args);
    world.send(ix, &[&admin]).unwrap();

    let sender = world.funded_keypair();
    let recipient = solana_address::Address::new_unique();
    let mint = world.usdc;
    world.fund_tokens(&sender.pubkey(), mint, AMOUNT);
    let ix = world.ix_create_hold(&sender.pubkey(), &recipient, mint, 1, 1, 599, 1);
    assert_eq!(world.send(ix, &[&sender]), Err(code(E::WindowTooShort)));
    let ix = world.ix_create_hold(&sender.pubkey(), &recipient, mint, 1, 1, 600, 1);
    world.send(ix, &[&sender]).unwrap();
}

#[test]
fn pause_blocks_new_holds_but_never_refunds() {
    let mut s = scene(usdc);
    let admin = s.world.admin.insecure_clone();
    let args = UpdateConfigArgs {
        paused: Some(true),
        ..Default::default()
    };
    let ix = s.world.ix_update_config(&admin.pubkey(), args);
    s.world.send(ix, &[&admin]).unwrap();

    let mint = s.world.usdc;
    let ix = s
        .world
        .ix_create_hold(&s.sender.pubkey(), &s.recipient, mint, 2, 1, WINDOW, 1);
    assert_eq!(s.world.send(ix, &[&s.sender]), Err(code(E::Paused)));
    let ix = s
        .world
        .ix_create_hold_sol(&s.sender.pubkey(), &s.recipient, 3, LAMPORTS, WINDOW, 1);
    assert_eq!(s.world.send(ix, &[&s.sender]), Err(code(E::Paused)));

    let ix = s
        .world
        .ix_reclaim(&s.sender.pubkey(), &s.hold, &s.sender_token);
    s.world.send(ix, &[&s.sender]).unwrap();
    assert_eq!(s.world.tokens(&s.sender_token), 100 * AMOUNT);
}

// ---- reclaim --------------------------------------------------------------------

#[test]
fn sender_reclaims_until_the_last_second_of_the_window() {
    let mut s = scene(usdc);
    let release_at = s.created_at + i64::from(WINDOW);
    s.world.warp_to(release_at - 1);

    let ix = s
        .world
        .ix_reclaim(&s.sender.pubkey(), &s.hold, &s.sender_token);
    s.world.send(ix, &[&s.sender]).unwrap();

    assert_eq!(s.world.tokens(&s.sender_token), 100 * AMOUNT);
    let vault = ata(&s.hold, &s.world.usdc.mint, &s.world.usdc.program);
    assert!(!s.world.exists(&vault), "vault is closed");
    assert_eq!(s.world.hold(&s.hold).unwrap().status, status::RECLAIMED);
    let stats = s.world.stats(&s.recipient).unwrap();
    assert_eq!(
        (
            stats.holds_received,
            stats.holds_reclaimed_against,
            stats.holds_released_to
        ),
        (1, 1, 0)
    );
}

#[test]
fn reclaim_fails_from_the_release_second_onwards() {
    let mut s = scene(usdc);
    s.world.warp_to(s.created_at + i64::from(WINDOW));
    let ix = s
        .world
        .ix_reclaim(&s.sender.pubkey(), &s.hold, &s.sender_token);
    assert_eq!(s.world.send(ix, &[&s.sender]), Err(code(E::WindowOver)));
}

#[test]
fn nobody_else_can_reclaim_and_refunds_only_reach_the_sender() {
    let mut s = scene(usdc);
    let mint = s.world.usdc;
    let attacker = s.world.funded_keypair();
    let attacker_token = s.world.fund_tokens(&attacker.pubkey(), mint, 0);

    // A stranger, the oracle and the relayer cannot undo a wallet-origin hold.
    let oracle = s.world.oracle.insecure_clone();
    let relayer = s.world.relayer.insecure_clone();
    for signer in [&attacker, &oracle, &relayer] {
        let ix = s
            .world
            .ix_reclaim(&signer.pubkey(), &s.hold, &s.sender_token);
        assert_eq!(s.world.send(ix, &[signer]), Err(code(E::Unauthorized)));
    }

    // Even the sender cannot redirect the refund to someone else's account.
    let ix = s
        .world
        .ix_reclaim(&s.sender.pubkey(), &s.hold, &attacker_token);
    assert!(s.world.send(ix, &[&s.sender]).is_err());
    assert_eq!(s.world.tokens(&attacker_token), 0);
}

#[test]
fn a_settled_hold_cannot_be_settled_again() {
    let mut s = scene(usdc);
    let ix = s
        .world
        .ix_reclaim(&s.sender.pubkey(), &s.hold, &s.sender_token);
    s.world.send(ix.clone(), &[&s.sender]).unwrap();
    // The vault is gone, so every further settlement attempt fails.
    assert!(s.world.send(ix, &[&s.sender]).is_err());
    s.world.warp(i64::from(WINDOW) + 1);
    let cranker = s.world.funded_keypair();
    let ix = s
        .world
        .ix_release(&cranker.pubkey(), &s.hold, &s.recipient, false);
    assert!(s.world.send(ix, &[&cranker]).is_err());
}

// ---- release --------------------------------------------------------------------

#[test]
fn anyone_releases_from_the_release_second_and_not_before() {
    let mut s = scene(usdc);
    let cranker = s.world.funded_keypair();
    let release_at = s.created_at + i64::from(WINDOW);

    s.world.warp_to(release_at - 1);
    let ix = s
        .world
        .ix_release(&cranker.pubkey(), &s.hold, &s.recipient, false);
    assert_eq!(s.world.send(ix, &[&cranker]), Err(code(E::WindowNotOver)));

    s.world.warp_to(release_at);
    let ix = s
        .world
        .ix_release(&cranker.pubkey(), &s.hold, &s.recipient, false);
    s.world.send(ix, &[&cranker]).unwrap();

    let recipient_token = ata(&s.recipient, &s.world.usdc.mint, &s.world.usdc.program);
    assert_eq!(s.world.tokens(&recipient_token), AMOUNT);
    assert_eq!(s.world.hold(&s.hold).unwrap().status, status::RELEASED);
    let stats = s.world.stats(&s.recipient).unwrap();
    assert_eq!(
        (stats.holds_reclaimed_against, stats.holds_released_to),
        (0, 1)
    );
}

#[test]
fn release_cannot_pay_anyone_but_the_recipient() {
    let mut s = scene(usdc);
    let attacker = s.world.funded_keypair();
    s.world.warp(i64::from(WINDOW));
    let ix = s
        .world
        .ix_release(&attacker.pubkey(), &s.hold, &attacker.pubkey(), false);
    assert_eq!(s.world.send(ix, &[&attacker]), Err(code(E::WrongParty)));
}

#[test]
fn only_the_sender_releases_early() {
    let mut s = scene(usdc);
    let attacker = s.world.funded_keypair();
    let relayer = s.world.relayer.insecure_clone();
    for signer in [&attacker, &relayer] {
        let ix = s
            .world
            .ix_release(&signer.pubkey(), &s.hold, &s.recipient, true);
        assert_eq!(s.world.send(ix, &[signer]), Err(code(E::Unauthorized)));
    }
    let ix = s
        .world
        .ix_release(&s.sender.pubkey(), &s.hold, &s.recipient, true);
    s.world.send(ix, &[&s.sender]).unwrap();
    let recipient_token = ata(&s.recipient, &s.world.usdc.mint, &s.world.usdc.program);
    assert_eq!(s.world.tokens(&recipient_token), AMOUNT);

    // Early release is final: the sender cannot undo afterwards.
    let ix = s
        .world
        .ix_reclaim(&s.sender.pubkey(), &s.hold, &s.sender_token);
    assert!(s.world.send(ix, &[&s.sender]).is_err());
}

// ---- extend_window ----------------------------------------------------------------

#[test]
fn oracle_extends_but_never_shortens_and_never_beyond_max() {
    let mut s = scene(usdc);
    let oracle = s.world.oracle.insecure_clone();
    let release_at = s.created_at + i64::from(WINDOW);

    let ix = s
        .world
        .ix_extend_window(&oracle.pubkey(), &s.hold, release_at - 1, tier::FLAGGED);
    assert_eq!(
        s.world.send(ix, &[&oracle]),
        Err(code(E::WindowCannotShrink))
    );

    let too_late = s.created_at + i64::from(MAX_WINDOW) + 1;
    let ix = s
        .world
        .ix_extend_window(&oracle.pubkey(), &s.hold, too_late, tier::FLAGGED);
    assert_eq!(s.world.send(ix, &[&oracle]), Err(code(E::WindowTooLong)));

    let ix = s
        .world
        .ix_extend_window(&oracle.pubkey(), &s.hold, release_at, tier::TRUSTED);
    assert_eq!(s.world.send(ix, &[&oracle]), Err(code(E::TierCannotDrop)));

    let ix = s
        .world
        .ix_extend_window(&oracle.pubkey(), &s.hold, release_at, 9);
    assert_eq!(s.world.send(ix, &[&oracle]), Err(code(E::InvalidTier)));

    let new_release = s.created_at + 86_400;
    let ix = s
        .world
        .ix_extend_window(&oracle.pubkey(), &s.hold, new_release, tier::FLAGGED);
    s.world.send(ix, &[&oracle]).unwrap();
    let hold = s.world.hold(&s.hold).unwrap();
    assert_eq!(
        (hold.release_at, hold.tier, hold.evidence_hash),
        (new_release, tier::FLAGGED, [8u8; 32])
    );

    // The original window has passed, but the extension keeps the funds
    // reclaimable and unreleasable.
    s.world.warp_to(release_at + 10);
    let cranker = s.world.funded_keypair();
    let ix = s
        .world
        .ix_release(&cranker.pubkey(), &s.hold, &s.recipient, false);
    assert_eq!(s.world.send(ix, &[&cranker]), Err(code(E::WindowNotOver)));
    let ix = s
        .world
        .ix_reclaim(&s.sender.pubkey(), &s.hold, &s.sender_token);
    s.world.send(ix, &[&s.sender]).unwrap();
}

#[test]
fn only_the_oracle_extends_and_only_while_the_window_runs() {
    let mut s = scene(usdc);
    let release_at = s.created_at + i64::from(WINDOW);
    let attacker = s.world.funded_keypair();
    let relayer = s.world.relayer.insecure_clone();
    for signer in [&attacker, &relayer, &s.sender.insecure_clone()] {
        let ix =
            s.world
                .ix_extend_window(&signer.pubkey(), &s.hold, release_at + 60, tier::FLAGGED);
        assert_eq!(s.world.send(ix, &[signer]), Err(code(E::Unauthorized)));
    }

    // Once the window is over the recipient is owed the money.
    s.world.warp_to(release_at);
    let oracle = s.world.oracle.insecure_clone();
    let ix = s
        .world
        .ix_extend_window(&oracle.pubkey(), &s.hold, release_at + 60, tier::FLAGGED);
    assert_eq!(s.world.send(ix, &[&oracle]), Err(code(E::WindowOver)));
}

#[test]
fn extending_moves_no_funds() {
    let mut s = scene(usdc);
    let oracle = s.world.oracle.insecure_clone();
    let vault = ata(&s.hold, &s.world.usdc.mint, &s.world.usdc.program);
    let before = (
        s.world.tokens(&vault),
        s.world.tokens(&s.sender_token),
        s.world.lamports(&s.hold),
    );
    let ix = s.world.ix_extend_window(
        &oracle.pubkey(),
        &s.hold,
        s.created_at + 7_200,
        tier::SUSPICIOUS,
    );
    s.world.send(ix, &[&oracle]).unwrap();
    let after = (
        s.world.tokens(&vault),
        s.world.tokens(&s.sender_token),
        s.world.lamports(&s.hold),
    );
    assert_eq!(before, after);
}

// ---- close ----------------------------------------------------------------------

#[test]
fn closing_refunds_every_lamport_of_rent_to_the_rent_payer() {
    let mut world = World::new();
    let sender = world.funded_keypair();
    let recipient = solana_address::Address::new_unique();
    let mint = world.usdc;
    let sender_token = world.fund_tokens(&sender.pubkey(), mint, AMOUNT);
    // Create the stats account first so its (non-refundable) rent does not
    // blur the measurement.
    let ix = world.ix_create_hold(&sender.pubkey(), &recipient, mint, 1, 1, WINDOW, 1);
    world.send(ix, &[&sender]).unwrap();

    let before = world.lamports(&sender.pubkey());
    let ix = world.ix_create_hold(&sender.pubkey(), &recipient, mint, 2, 5, WINDOW, 1);
    world.send(ix, &[&sender]).unwrap();
    let hold = hold_pda(&sender.pubkey(), 2);
    assert!(world.lamports(&sender.pubkey()) < before);

    let stranger = world.funded_keypair();
    let ix = world.ix_close_hold(&stranger.pubkey(), &hold, &sender.pubkey());
    assert_eq!(world.send(ix, &[&stranger]), Err(code(E::HoldStillPending)));

    let ix = world.ix_reclaim(&sender.pubkey(), &hold, &sender_token);
    world.send(ix, &[&sender]).unwrap();

    // Rent cannot be redirected to the caller.
    let ix = world.ix_close_hold(&stranger.pubkey(), &hold, &stranger.pubkey());
    assert_eq!(world.send(ix, &[&stranger]), Err(code(E::WrongParty)));

    // Anyone may close; the rent still goes to the rent payer.
    let ix = world.ix_close_hold(&stranger.pubkey(), &hold, &sender.pubkey());
    world.send(ix, &[&stranger]).unwrap();
    assert!(!world.exists(&hold));
    assert_eq!(world.lamports(&sender.pubkey()), before);
}

// ---- trust and instant transfers --------------------------------------------------

#[test]
fn instant_transfer_needs_the_trust_account() {
    let mut world = World::new();
    let sender = world.funded_keypair();
    let recipient = solana_address::Address::new_unique();
    let mint = world.usdc;
    let sender_token = world.fund_tokens(&sender.pubkey(), mint, AMOUNT);
    let recipient_token = ata(&recipient, &mint.mint, &mint.program);

    let ix = world.ix_instant_transfer(&sender.pubkey(), &recipient, mint, 10);
    assert!(
        world.send(ix, &[&sender]).is_err(),
        "no trust account, no instant transfer"
    );

    let ix = world.ix_set_trust(&sender.pubkey(), &recipient);
    world.send(ix, &[&sender]).unwrap();
    let ix = world.ix_set_trust(&sender.pubkey(), &recipient);
    assert!(world.send(ix, &[&sender]).is_err(), "trust is set once");

    let ix = world.ix_instant_transfer(&sender.pubkey(), &recipient, mint, 0);
    assert_eq!(world.send(ix, &[&sender]), Err(code(E::ZeroAmount)));

    let ix = world.ix_instant_transfer(&sender.pubkey(), &recipient, mint, 10);
    world.send(ix, &[&sender]).unwrap();
    assert_eq!(world.tokens(&recipient_token), 10);
    assert_eq!(world.tokens(&sender_token), AMOUNT - 10);
    assert_eq!(world.stats(&recipient).unwrap().holds_released_to, 1);

    // Trust in A does not let anyone else pay A instantly, nor the sender pay B.
    let other = world.funded_keypair();
    world.fund_tokens(&other.pubkey(), mint, AMOUNT);
    let ix = world.ix_instant_transfer(&other.pubkey(), &recipient, mint, 10);
    assert!(world.send(ix, &[&other]).is_err());

    let ix = world.ix_remove_trust(&sender.pubkey(), &recipient);
    world.send(ix, &[&sender]).unwrap();
    let ix = world.ix_instant_transfer(&sender.pubkey(), &recipient, mint, 10);
    assert!(world.send(ix, &[&sender]).is_err(), "trust removed");
}

#[test]
fn instant_transfer_is_off_when_the_minimum_window_is_positive() {
    let mut world = World::new();
    let admin = world.admin.insecure_clone();
    let args = UpdateConfigArgs {
        min_window_secs: Some(60),
        ..Default::default()
    };
    let ix = world.ix_update_config(&admin.pubkey(), args);
    world.send(ix, &[&admin]).unwrap();

    let sender = world.funded_keypair();
    let recipient = solana_address::Address::new_unique();
    let ix = world.ix_set_trust(&sender.pubkey(), &recipient);
    world.send(ix, &[&sender]).unwrap();
    let ix = world.ix_instant_transfer_sol(&sender.pubkey(), &recipient, LAMPORTS);
    assert_eq!(world.send(ix, &[&sender]), Err(code(E::WindowTooShort)));
}

#[test]
fn instant_sol_transfer_pays_the_trusted_recipient() {
    let mut world = World::new();
    let sender = world.funded_keypair();
    let recipient = solana_address::Address::new_unique();
    let ix = world.ix_set_trust(&sender.pubkey(), &recipient);
    world.send(ix, &[&sender]).unwrap();
    let ix = world.ix_instant_transfer_sol(&sender.pubkey(), &recipient, 2 * LAMPORTS);
    world.send(ix, &[&sender]).unwrap();
    assert_eq!(world.lamports(&recipient), 2 * LAMPORTS);
}

// ---- native SOL holds ---------------------------------------------------------------

#[test]
fn sol_hold_reclaim_and_release() {
    let mut world = World::new();
    let sender = world.funded_keypair();
    let recipient = solana_address::Address::new_unique();
    let me = sender.pubkey();

    let ix = world.ix_create_hold_sol(&me, &recipient, 1, 1_000, WINDOW, 1);
    assert_eq!(
        world.send(ix, &[&sender]),
        Err(code(E::AmountBelowRentFloor))
    );

    let ix = world.ix_create_hold_sol(&me, &recipient, 1, 3 * LAMPORTS, WINDOW, 1);
    world.send(ix, &[&sender]).unwrap();
    let first = hold_pda(&me, 1);
    let state = world.hold(&first).unwrap();
    assert_eq!(state.mint, NATIVE_SOL_MINT);
    assert_eq!(state.amount, 3 * LAMPORTS);

    // Token instructions refuse a SOL hold and vice versa is covered below.
    let before = world.lamports(&me);
    let ix = world.ix_reclaim_sol(&me, &first, &me);
    world.send(ix, &[&sender]).unwrap();
    assert_eq!(world.lamports(&me), before + 3 * LAMPORTS);
    assert_eq!(world.hold(&first).unwrap().status, status::RECLAIMED);

    let ix = world.ix_create_hold_sol(&me, &recipient, 2, 2 * LAMPORTS, WINDOW, 1);
    world.send(ix, &[&sender]).unwrap();
    let second = hold_pda(&me, 2);
    let cranker = world.funded_keypair();

    let ix = world.ix_release_sol(&cranker.pubkey(), &second, &recipient, false);
    assert_eq!(world.send(ix, &[&cranker]), Err(code(E::WindowNotOver)));
    let ix = world.ix_release_sol(&cranker.pubkey(), &second, &cranker.pubkey(), false);
    assert_eq!(world.send(ix, &[&cranker]), Err(code(E::WrongParty)));
    let ix = world.ix_reclaim_sol(&cranker.pubkey(), &second, &cranker.pubkey());
    assert_eq!(world.send(ix, &[&cranker]), Err(code(E::Unauthorized)));
    let ix = world.ix_reclaim_sol(&me, &second, &cranker.pubkey());
    assert_eq!(world.send(ix, &[&sender]), Err(code(E::WrongParty)));

    world.warp(i64::from(WINDOW));
    let ix = world.ix_release_sol(&cranker.pubkey(), &second, &recipient, false);
    world.send(ix, &[&cranker]).unwrap();
    assert_eq!(world.lamports(&recipient), 2 * LAMPORTS);

    // The hold account keeps exactly its rent, which close returns.
    let rent = world.lamports(&second);
    let before = world.lamports(&me);
    let ix = world.ix_close_hold(&cranker.pubkey(), &second, &me);
    world.send(ix, &[&cranker]).unwrap();
    assert_eq!(world.lamports(&me), before + rent);
}

#[test]
fn sol_hold_early_release_is_sender_only() {
    let mut world = World::new();
    let sender = world.funded_keypair();
    let recipient = solana_address::Address::new_unique();
    let ix = world.ix_create_hold_sol(&sender.pubkey(), &recipient, 1, LAMPORTS, WINDOW, 1);
    world.send(ix, &[&sender]).unwrap();
    let hold = hold_pda(&sender.pubkey(), 1);

    let stranger = world.funded_keypair();
    let ix = world.ix_release_sol(&stranger.pubkey(), &hold, &recipient, true);
    assert_eq!(world.send(ix, &[&stranger]), Err(code(E::Unauthorized)));
    let ix = world.ix_release_sol(&sender.pubkey(), &hold, &recipient, true);
    world.send(ix, &[&sender]).unwrap();
    assert_eq!(world.lamports(&recipient), LAMPORTS);
}

// ---- Token-2022 ------------------------------------------------------------------

#[test]
fn token_2022_mints_follow_the_same_lifecycle() {
    let mut s = scene(token22);
    let mint = s.world.token22;
    let vault = ata(&s.hold, &mint.mint, &mint.program);
    assert_eq!(s.world.tokens(&vault), AMOUNT);

    let ix = s
        .world
        .ix_reclaim(&s.sender.pubkey(), &s.hold, &s.sender_token);
    s.world.send(ix, &[&s.sender]).unwrap();
    assert_eq!(s.world.tokens(&s.sender_token), 100 * AMOUNT);

    let ix = s
        .world
        .ix_create_hold(&s.sender.pubkey(), &s.recipient, mint, 2, AMOUNT, WINDOW, 1);
    s.world.send(ix, &[&s.sender]).unwrap();
    s.world.warp(i64::from(WINDOW));
    let cranker = s.world.funded_keypair();
    let hold = hold_pda(&s.sender.pubkey(), 2);
    let ix = s
        .world
        .ix_release(&cranker.pubkey(), &hold, &s.recipient, false);
    s.world.send(ix, &[&cranker]).unwrap();
    assert_eq!(
        s.world
            .tokens(&ata(&s.recipient, &mint.mint, &mint.program)),
        AMOUNT
    );
}

#[test]
fn a_hold_cannot_be_settled_with_a_different_mint() {
    let mut s = scene(usdc);
    let other = s.world.create_mint(TOKEN_PROGRAM);
    let other_token = s.world.fund_tokens(&s.sender.pubkey(), other, 0);

    let mut ix = s
        .world
        .ix_reclaim(&s.sender.pubkey(), &s.hold, &other_token);
    // Swap the mint account (index 3) for the other mint.
    ix.accounts[3].pubkey = other.mint;
    assert_eq!(s.world.send(ix, &[&s.sender]), Err(code(E::MintMismatch)));
}

// ---- deposit box -----------------------------------------------------------------

struct BoxScene {
    world: World,
    owner: solana_keypair::Keypair,
    owner_token: solana_address::Address,
    box_token: solana_address::Address,
    recipient: solana_address::Address,
}

/// An owner whose deposit box holds 10 * AMOUNT.
fn box_scene() -> BoxScene {
    let mut world = World::new();
    let owner = world.funded_keypair();
    let mint = world.usdc;
    let owner_token = world.fund_tokens(&owner.pubkey(), mint, 0);
    let relayer = world.relayer.insecure_clone();
    let ix = world.ix_init_deposit_box(&relayer.pubkey(), &owner.pubkey(), mint);
    world.send(ix, &[&relayer]).unwrap();
    // The owner "sends a payment" to the box, as an embedded wallet would.
    let box_token = world.fund_tokens(&box_pda(&owner.pubkey()), mint, 10 * AMOUNT);
    BoxScene {
        world,
        owner,
        owner_token,
        box_token,
        recipient: solana_address::Address::new_unique(),
    }
}

#[test]
fn relayer_opens_a_hold_whose_sender_is_the_box_owner() {
    let mut b = box_scene();
    let mint = b.world.usdc;
    let relayer = b.world.relayer.insecure_clone();
    let owner = b.owner.pubkey();

    let attacker = b.world.funded_keypair();
    let ix = b.world.ix_open_hold_from_deposit(
        &attacker.pubkey(),
        &owner,
        &b.recipient,
        mint,
        1,
        AMOUNT,
        DEFAULT_WINDOW,
        1,
    );
    assert_eq!(b.world.send(ix, &[&attacker]), Err(code(E::Unauthorized)));

    // The relayer cannot go below the default window.
    let ix = b.world.ix_open_hold_from_deposit(
        &relayer.pubkey(),
        &owner,
        &b.recipient,
        mint,
        1,
        AMOUNT,
        DEFAULT_WINDOW - 1,
        1,
    );
    assert_eq!(b.world.send(ix, &[&relayer]), Err(code(E::WindowTooShort)));

    let ix = b.world.ix_open_hold_from_deposit(
        &relayer.pubkey(),
        &owner,
        &b.recipient,
        mint,
        1,
        AMOUNT,
        DEFAULT_WINDOW,
        2,
    );
    b.world.send(ix, &[&relayer]).unwrap();

    let hold_address = hold_pda(&owner, 1);
    let hold = b.world.hold(&hold_address).unwrap();
    assert_eq!(addr(&hold.sender), owner);
    assert_eq!(hold.origin, origin::DEPOSIT_BOX);
    assert_eq!(addr(&hold.rent_payer), relayer.pubkey());
    assert_eq!(b.world.tokens(&b.box_token), 9 * AMOUNT);

    // The relayer cannot release early and cannot refund to itself.
    let ix = b
        .world
        .ix_release(&relayer.pubkey(), &hold_address, &b.recipient, true);
    assert_eq!(b.world.send(ix, &[&relayer]), Err(code(E::Unauthorized)));
    let relayer_token = b.world.fund_tokens(&relayer.pubkey(), mint, 0);
    let ix = b
        .world
        .ix_reclaim(&relayer.pubkey(), &hold_address, &relayer_token);
    assert!(b.world.send(ix, &[&relayer]).is_err());

    // The relayer's undo sends the money to the owner's own wallet.
    let ix = b
        .world
        .ix_reclaim(&relayer.pubkey(), &hold_address, &b.owner_token);
    b.world.send(ix, &[&relayer]).unwrap();
    assert_eq!(b.world.tokens(&b.owner_token), AMOUNT);
}

#[test]
fn the_owner_can_also_undo_a_box_hold_directly() {
    let mut b = box_scene();
    let mint = b.world.usdc;
    let relayer = b.world.relayer.insecure_clone();
    let owner = b.owner.pubkey();
    let ix = b.world.ix_open_hold_from_deposit(
        &relayer.pubkey(),
        &owner,
        &b.recipient,
        mint,
        1,
        AMOUNT,
        DEFAULT_WINDOW,
        1,
    );
    b.world.send(ix, &[&relayer]).unwrap();
    let ix = b
        .world
        .ix_reclaim(&owner, &hold_pda(&owner, 1), &b.owner_token);
    b.world.send(ix, &[&b.owner]).unwrap();
    assert_eq!(b.world.tokens(&b.owner_token), AMOUNT);
}

#[test]
fn withdrawals_from_a_box_only_reach_the_owner() {
    let mut b = box_scene();
    let mint = b.world.usdc;
    let relayer = b.world.relayer.insecure_clone();
    let owner = b.owner.pubkey();
    let attacker = b.world.funded_keypair();
    let attacker_token = b.world.fund_tokens(&attacker.pubkey(), mint, 0);
    let relayer_token = b.world.fund_tokens(&relayer.pubkey(), mint, 0);

    let ix = b
        .world
        .ix_withdraw_deposit(&attacker.pubkey(), &owner, mint, &attacker_token, AMOUNT);
    assert_eq!(b.world.send(ix, &[&attacker]), Err(code(E::Unauthorized)));
    let ix = b
        .world
        .ix_withdraw_deposit(&relayer.pubkey(), &owner, mint, &relayer_token, AMOUNT);
    assert!(
        b.world.send(ix, &[&relayer]).is_err(),
        "relayer cannot pay itself"
    );
    let ix = b
        .world
        .ix_withdraw_deposit(&relayer.pubkey(), &owner, mint, &b.owner_token, 0);
    assert_eq!(b.world.send(ix, &[&relayer]), Err(code(E::ZeroAmount)));

    let ix = b
        .world
        .ix_withdraw_deposit(&relayer.pubkey(), &owner, mint, &b.owner_token, AMOUNT);
    b.world.send(ix, &[&relayer]).unwrap();
    let ix = b
        .world
        .ix_withdraw_deposit(&owner, &owner, mint, &b.owner_token, AMOUNT);
    b.world.send(ix, &[&b.owner]).unwrap();
    assert_eq!(b.world.tokens(&b.owner_token), 2 * AMOUNT);
    assert_eq!(b.world.tokens(&b.box_token), 8 * AMOUNT);
    assert_eq!(
        b.world.tokens(&attacker_token) + b.world.tokens(&relayer_token),
        0
    );
}

#[test]
fn a_rotated_relayer_key_loses_all_powers() {
    let mut b = box_scene();
    let mint = b.world.usdc;
    let old_relayer = b.world.relayer.insecure_clone();
    let owner = b.owner.pubkey();
    let admin = b.world.admin.insecure_clone();
    let new_relayer = b.world.funded_keypair();
    let args = UpdateConfigArgs {
        relayer: Some(pk(&new_relayer.pubkey())),
        ..Default::default()
    };
    let ix = b.world.ix_update_config(&admin.pubkey(), args);
    b.world.send(ix, &[&admin]).unwrap();

    let ix = b.world.ix_open_hold_from_deposit(
        &old_relayer.pubkey(),
        &owner,
        &b.recipient,
        mint,
        1,
        AMOUNT,
        DEFAULT_WINDOW,
        1,
    );
    assert_eq!(
        b.world.send(ix, &[&old_relayer]),
        Err(code(E::Unauthorized))
    );
    let ix = b
        .world
        .ix_withdraw_deposit(&old_relayer.pubkey(), &owner, mint, &b.owner_token, 1);
    assert_eq!(
        b.world.send(ix, &[&old_relayer]),
        Err(code(E::Unauthorized))
    );
}

// ---- flags ----------------------------------------------------------------------

#[test]
fn one_flag_per_reporter_per_subject() {
    let mut world = World::new();
    let alice = world.funded_keypair();
    let bob = world.funded_keypair();
    let subject = solana_address::Address::new_unique();

    let ix = world.ix_flag_subject(&alice.pubkey(), &subject, 9);
    assert_eq!(world.send(ix, &[&alice]), Err(code(E::InvalidReason)));
    let ix = world.ix_flag_subject(&alice.pubkey(), &alice.pubkey(), 1);
    assert_eq!(world.send(ix, &[&alice]), Err(code(E::SelfTransfer)));

    let ix = world.ix_flag_subject(&alice.pubkey(), &subject, 1);
    world.send(ix, &[&alice]).unwrap();
    let ix = world.ix_flag_subject(&alice.pubkey(), &subject, 2);
    assert!(
        world.send(ix, &[&alice]).is_err(),
        "second flag by the same reporter"
    );
    let ix = world.ix_flag_subject(&bob.pubkey(), &subject, 6);
    world.send(ix, &[&bob]).unwrap();

    assert_eq!(world.stats(&subject).unwrap().flags, 2);
}
