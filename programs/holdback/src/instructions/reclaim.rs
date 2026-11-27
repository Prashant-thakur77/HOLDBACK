use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use super::shared::{bump_counter, drain_and_close_vault, pay_out_sol, require_pending};
use crate::constants::*;
use crate::errors::HoldbackError;
use crate::events::HoldReclaimed;
use crate::state::{Config, Hold, SubjectStats};

/// The sender may always undo their own hold. The relayer may undo only
/// holds it opened from a deposit box, and the refund still goes to the
/// sender.
fn may_reclaim(hold: &Hold, config: &Config, authority: &Pubkey) -> bool {
    *authority == hold.sender
        || (hold.origin == origin::DEPOSIT_BOX && *authority == config.relayer)
}

#[derive(Accounts)]
pub struct Reclaim<'info> {
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [HOLD_SEED, hold.sender.as_ref(), &hold.nonce.to_le_bytes()],
        bump = hold.bump,
        constraint = may_reclaim(&hold, &config, authority.key) @ HoldbackError::Unauthorized,
        constraint = !hold.is_sol() @ HoldbackError::NotTokenHold,
    )]
    pub hold: Box<Account<'info, Hold>>,

    #[account(address = hold.mint @ HoldbackError::MintMismatch)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = hold,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The refund destination: any token account of this mint that the
    /// hold's sender owns. No signer can point it anywhere else.
    #[account(
        mut,
        token::mint = mint,
        token::authority = hold.sender,
        token::token_program = token_program,
    )]
    pub sender_token: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: receives the vault's rent; must be the recorded rent payer.
    #[account(mut, address = hold.rent_payer @ HoldbackError::WrongParty)]
    pub rent_payer: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [STATS_SEED, hold.recipient.as_ref()],
        bump = recipient_stats.bump,
    )]
    pub recipient_stats: Box<Account<'info, SubjectStats>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn reclaim_token(ctx: Context<Reclaim>) -> Result<()> {
    let now = require_pending(&ctx.accounts.hold)?;
    require!(now < ctx.accounts.hold.release_at, HoldbackError::WindowOver);

    let amount = drain_and_close_vault(
        &ctx.accounts.hold,
        &ctx.accounts.vault,
        &ctx.accounts.mint,
        ctx.accounts.sender_token.to_account_info(),
        ctx.accounts.rent_payer.to_account_info(),
        &ctx.accounts.token_program,
    )?;

    finish(
        &mut ctx.accounts.hold,
        &mut ctx.accounts.recipient_stats,
        ctx.accounts.authority.key(),
        amount,
        now,
    )
}

#[derive(Accounts)]
pub struct ReclaimSol<'info> {
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [HOLD_SEED, hold.sender.as_ref(), &hold.nonce.to_le_bytes()],
        bump = hold.bump,
        constraint = may_reclaim(&hold, &config, authority.key) @ HoldbackError::Unauthorized,
        constraint = hold.is_sol() @ HoldbackError::NotSolHold,
    )]
    pub hold: Box<Account<'info, Hold>>,

    /// CHECK: the refund destination; must be the hold's sender.
    #[account(mut, address = hold.sender @ HoldbackError::WrongParty)]
    pub sender: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [STATS_SEED, hold.recipient.as_ref()],
        bump = recipient_stats.bump,
    )]
    pub recipient_stats: Box<Account<'info, SubjectStats>>,
}

pub fn reclaim_sol(ctx: Context<ReclaimSol>) -> Result<()> {
    let now = require_pending(&ctx.accounts.hold)?;
    require!(now < ctx.accounts.hold.release_at, HoldbackError::WindowOver);

    let amount = pay_out_sol(&ctx.accounts.hold, &ctx.accounts.sender.to_account_info())?;

    finish(
        &mut ctx.accounts.hold,
        &mut ctx.accounts.recipient_stats,
        ctx.accounts.authority.key(),
        amount,
        now,
    )
}

fn finish(
    hold: &mut Account<Hold>,
    stats: &mut Account<SubjectStats>,
    by: Pubkey,
    amount: u64,
    now: i64,
) -> Result<()> {
    hold.status = status::RECLAIMED;
    stats.holds_reclaimed_against = bump_counter(stats.holds_reclaimed_against)?;

    emit!(HoldReclaimed {
        hold: hold.key(),
        sender: hold.sender,
        recipient: hold.recipient,
        mint: hold.mint,
        amount,
        timestamp: now,
        tier: hold.tier,
        by,
    });
    Ok(())
}
