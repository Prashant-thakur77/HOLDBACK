//! HOLDBACK: every payment gets an undo window.
//!
//! A sender places funds in a [`state::Hold`]. Until `release_at` only the
//! sender can move them, and only back to the sender. After `release_at`
//! anyone can crank them to the recipient. A risk oracle may lengthen a
//! pending window when new evidence appears; nobody can shorten one.
//!
//! Trust model in one paragraph: the **oracle** key can only call
//! `extend_window`, which moves no funds and can only delay release, up to
//! `max_window_secs` after creation. The **relayer** key serves wallets that
//! cannot sign program instructions; it can only move a deposit box's funds
//! back to the box owner or into a hold whose sender is that owner, with at
//! least the default window. The **admin** can change service keys and window
//! limits and pause new holds, but has no instruction that touches a vault.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("26Tx1zAiL26RfxqTAVDaFaD2TTVku4Hm2vy3LBw8unom");

#[program]
pub mod holdback {
    use super::*;

    /// Creates the singleton config. Only the program's upgrade authority can
    /// call this, and only once.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        relayer: Pubkey,
        risk_oracle: Pubkey,
        min_window_secs: u32,
        default_window_secs: u32,
        max_window_secs: u32,
    ) -> Result<()> {
        instructions::config::initialize_config(
            ctx,
            relayer,
            risk_oracle,
            min_window_secs,
            default_window_secs,
            max_window_secs,
        )
    }

    /// Admin-only update of service keys, window limits and the pause switch.
    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        instructions::config::update_config(ctx, args)
    }

    /// Places `amount` of an SPL / Token-2022 token in a new hold.
    pub fn create_hold(
        ctx: Context<CreateHold>,
        nonce: u64,
        amount: u64,
        window_secs: u32,
        tier: u8,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        instructions::create_hold::create_token(
            ctx,
            nonce,
            amount,
            window_secs,
            tier,
            evidence_hash,
        )
    }

    /// Places `amount` lamports in a new hold.
    pub fn create_hold_sol(
        ctx: Context<CreateHoldSol>,
        nonce: u64,
        amount: u64,
        window_secs: u32,
        tier: u8,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        instructions::create_hold::create_sol(ctx, nonce, amount, window_secs, tier, evidence_hash)
    }

    /// Places tokens in a new hold whose window, tier and evidence hash carry
    /// the risk oracle's signature, verified on-chain. The instruction must be
    /// preceded by an Ed25519 verification of the signed assessment.
    #[allow(clippy::too_many_arguments)]
    pub fn create_hold_attested(
        ctx: Context<CreateHoldAttested>,
        nonce: u64,
        amount: u64,
        window_secs: u32,
        attested_window_secs: u32,
        tier: u8,
        evidence_hash: [u8; 32],
        expires_at: i64,
    ) -> Result<()> {
        instructions::attested::create_token_attested(
            ctx,
            nonce,
            amount,
            window_secs,
            attested_window_secs,
            tier,
            evidence_hash,
            expires_at,
        )
    }

    /// The attested path for native SOL.
    #[allow(clippy::too_many_arguments)]
    pub fn create_hold_sol_attested(
        ctx: Context<CreateHoldSolAttested>,
        nonce: u64,
        amount: u64,
        window_secs: u32,
        attested_window_secs: u32,
        tier: u8,
        evidence_hash: [u8; 32],
        expires_at: i64,
    ) -> Result<()> {
        instructions::attested::create_sol_attested(
            ctx,
            nonce,
            amount,
            window_secs,
            attested_window_secs,
            tier,
            evidence_hash,
            expires_at,
        )
    }

    /// Zero-window path: pays a recipient the sender has marked as trusted
    /// directly, with no vault. Requires the `Trust` PDA to exist.
    pub fn instant_transfer(ctx: Context<InstantTransferToken>, amount: u64) -> Result<()> {
        instructions::instant::instant_token(ctx, amount)
    }

    /// Zero-window path for native SOL.
    pub fn instant_transfer_sol(ctx: Context<InstantTransferSol>, amount: u64) -> Result<()> {
        instructions::instant::instant_sol(ctx, amount)
    }

    /// Creates a deposit box for `owner` and its token account for `mint`.
    pub fn init_deposit_box(ctx: Context<InitDepositBox>) -> Result<()> {
        instructions::deposit_box::init_box(ctx)
    }

    /// Relayer-only: moves tokens from the owner's deposit box into a new
    /// hold whose sender is the box owner.
    pub fn open_hold_from_deposit(
        ctx: Context<OpenHoldFromDeposit>,
        nonce: u64,
        amount: u64,
        window_secs: u32,
        tier: u8,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        instructions::deposit_box::open_hold_from_box(
            ctx,
            nonce,
            amount,
            window_secs,
            tier,
            evidence_hash,
        )
    }

    /// Returns tokens from a deposit box to its owner. Owner or relayer signs.
    pub fn withdraw_deposit(ctx: Context<WithdrawDeposit>, amount: u64) -> Result<()> {
        instructions::deposit_box::withdraw_from_box(ctx, amount)
    }

    /// Oracle-only: lengthens a pending hold's window and raises its tier.
    pub fn extend_window(
        ctx: Context<ExtendWindow>,
        new_release_at: i64,
        tier: u8,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        instructions::extend_window::extend(ctx, new_release_at, tier, evidence_hash)
    }

    /// Undo: returns a pending token hold to the sender before `release_at`.
    pub fn reclaim(ctx: Context<Reclaim>) -> Result<()> {
        instructions::reclaim::reclaim_token(ctx)
    }

    /// Undo for a native SOL hold.
    pub fn reclaim_sol(ctx: Context<ReclaimSol>) -> Result<()> {
        instructions::reclaim::reclaim_sol(ctx)
    }

    /// Permissionless crank: pays the recipient once the window is over.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        instructions::release::release_token(ctx, false)
    }

    /// Sender-only: pays the recipient before the window is over.
    pub fn release_early(ctx: Context<Release>) -> Result<()> {
        instructions::release::release_token(ctx, true)
    }

    /// Permissionless crank for a native SOL hold.
    pub fn release_sol(ctx: Context<ReleaseSol>) -> Result<()> {
        instructions::release::release_sol(ctx, false)
    }

    /// Sender-only early release of a native SOL hold.
    pub fn release_early_sol(ctx: Context<ReleaseSol>) -> Result<()> {
        instructions::release::release_sol(ctx, true)
    }

    /// Marks `recipient` as trusted by the signer.
    pub fn set_trust(ctx: Context<SetTrust>) -> Result<()> {
        instructions::trust::set_trust(ctx)
    }

    /// Removes the signer's trust in `recipient` and refunds the rent.
    pub fn remove_trust(ctx: Context<RemoveTrust>) -> Result<()> {
        instructions::trust::remove_trust(ctx)
    }

    /// Records one scam report about `subject`. One per reporter per subject.
    pub fn flag_subject(
        ctx: Context<FlagSubject>,
        reason: u8,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        instructions::flag::flag(ctx, reason, evidence_hash)
    }

    /// Closes a released or reclaimed hold and refunds its rent.
    pub fn close_hold(ctx: Context<CloseHold>) -> Result<()> {
        instructions::close_hold::close(ctx)
    }
}
