use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use super::shared::{bump_counter, drain_and_close_vault, pay_out_sol, require_pending};
use crate::constants::*;
use crate::errors::HoldbackError;
use crate::events::HoldReleased;
use crate::state::{Hold, SubjectStats};

/// A normal release needs the window to be over and accepts any signer. An
/// early release needs the sender's own signature; the relayer cannot stand
/// in for the sender here, whatever the hold's origin.
fn check_release(hold: &Hold, caller: &Pubkey, early: bool) -> Result<i64> {
    let now = require_pending(hold)?;
    if early {
        require_keys_eq!(*caller, hold.sender, HoldbackError::Unauthorized);
    } else {
        require!(now >= hold.release_at, HoldbackError::WindowNotOver);
    }
    Ok(now)
}

#[derive(Accounts)]
pub struct Release<'info> {
    /// Anyone for `release`; the sender for `release_early`. Pays for the
    /// recipient's token account if it does not exist yet.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [HOLD_SEED, hold.sender.as_ref(), &hold.nonce.to_le_bytes()],
        bump = hold.bump,
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

    /// CHECK: must be the hold's recipient; owns `recipient_token`.
    #[account(address = hold.recipient @ HoldbackError::WrongParty)]
    pub recipient: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token: Box<InterfaceAccount<'info, TokenAccount>>,

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
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn release_token(ctx: Context<Release>, early: bool) -> Result<()> {
    let now = check_release(&ctx.accounts.hold, ctx.accounts.caller.key, early)?;

    let amount = drain_and_close_vault(
        &ctx.accounts.hold,
        &ctx.accounts.vault,
        &ctx.accounts.mint,
        ctx.accounts.recipient_token.to_account_info(),
        ctx.accounts.rent_payer.to_account_info(),
        &ctx.accounts.token_program,
    )?;

    finish(
        &mut ctx.accounts.hold,
        &mut ctx.accounts.recipient_stats,
        amount,
        now,
        early,
    )
}

#[derive(Accounts)]
pub struct ReleaseSol<'info> {
    /// Anyone for `release_sol`; the sender for `release_early_sol`.
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [HOLD_SEED, hold.sender.as_ref(), &hold.nonce.to_le_bytes()],
        bump = hold.bump,
        constraint = hold.is_sol() @ HoldbackError::NotSolHold,
    )]
    pub hold: Box<Account<'info, Hold>>,

    /// CHECK: the payout destination; must be the hold's recipient.
    #[account(mut, address = hold.recipient @ HoldbackError::WrongParty)]
    pub recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [STATS_SEED, hold.recipient.as_ref()],
        bump = recipient_stats.bump,
    )]
    pub recipient_stats: Box<Account<'info, SubjectStats>>,
}

pub fn release_sol(ctx: Context<ReleaseSol>, early: bool) -> Result<()> {
    let now = check_release(&ctx.accounts.hold, ctx.accounts.caller.key, early)?;

    let amount = pay_out_sol(
        &ctx.accounts.hold,
        &ctx.accounts.recipient.to_account_info(),
    )?;

    finish(
        &mut ctx.accounts.hold,
        &mut ctx.accounts.recipient_stats,
        amount,
        now,
        early,
    )
}

fn finish(
    hold: &mut Account<Hold>,
    stats: &mut Account<SubjectStats>,
    amount: u64,
    now: i64,
    early: bool,
) -> Result<()> {
    hold.status = status::RELEASED;
    stats.holds_released_to = bump_counter(stats.holds_released_to)?;

    emit!(HoldReleased {
        hold: hold.key(),
        sender: hold.sender,
        recipient: hold.recipient,
        mint: hold.mint,
        amount,
        timestamp: now,
        tier: hold.tier,
        early,
    });
    Ok(())
}
