use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use super::shared::bump_counter;
use crate::constants::*;
use crate::errors::HoldbackError;
use crate::events::InstantTransfer;
use crate::state::{Config, SubjectStats, Trust};

/// Checks shared by both instant paths: not paused, the config allows a
/// zero-second window, and the amount is positive. The `Trust` PDA itself is
/// enforced by the account constraints.
fn validate_instant(config: &Config, amount: u64) -> Result<i64> {
    require!(!config.paused, HoldbackError::Paused);
    require!(config.min_window_secs == 0, HoldbackError::WindowTooShort);
    require!(amount > 0, HoldbackError::ZeroAmount);
    Ok(Clock::get()?.unix_timestamp)
}

#[derive(Accounts)]
pub struct InstantTransferToken<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: bound to the `trust` PDA through its seeds.
    pub recipient: UncheckedAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// Proof that the sender trusts this recipient. Without it the account
    /// fails to deserialize and the transfer is refused.
    #[account(
        seeds = [TRUST_SEED, sender.key().as_ref(), recipient.key().as_ref()],
        bump = trust.bump,
    )]
    pub trust: Box<Account<'info, Trust>>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = sender,
        token::token_program = token_program,
    )]
    pub sender_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = sender,
        associated_token::mint = mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = sender,
        space = 8 + SubjectStats::INIT_SPACE,
        seeds = [STATS_SEED, recipient.key().as_ref()],
        bump,
    )]
    pub recipient_stats: Box<Account<'info, SubjectStats>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn instant_token(ctx: Context<InstantTransferToken>, amount: u64) -> Result<()> {
    let now = validate_instant(&ctx.accounts.config, amount)?;

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.sender_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.recipient_token.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let stats = &mut ctx.accounts.recipient_stats;
    stats.touch(ctx.accounts.recipient.key(), ctx.bumps.recipient_stats);
    stats.holds_released_to = bump_counter(stats.holds_released_to)?;

    emit!(InstantTransfer {
        sender: ctx.accounts.sender.key(),
        recipient: ctx.accounts.recipient.key(),
        mint: ctx.accounts.mint.key(),
        amount,
        timestamp: now,
        tier: tier::TRUSTED,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct InstantTransferSol<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: bound to the `trust` PDA through its seeds.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [TRUST_SEED, sender.key().as_ref(), recipient.key().as_ref()],
        bump = trust.bump,
    )]
    pub trust: Box<Account<'info, Trust>>,

    #[account(
        init_if_needed,
        payer = sender,
        space = 8 + SubjectStats::INIT_SPACE,
        seeds = [STATS_SEED, recipient.key().as_ref()],
        bump,
    )]
    pub recipient_stats: Box<Account<'info, SubjectStats>>,

    pub system_program: Program<'info, System>,
}

pub fn instant_sol(ctx: Context<InstantTransferSol>, amount: u64) -> Result<()> {
    let now = validate_instant(&ctx.accounts.config, amount)?;

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.sender.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
        ),
        amount,
    )?;

    let stats = &mut ctx.accounts.recipient_stats;
    stats.touch(ctx.accounts.recipient.key(), ctx.bumps.recipient_stats);
    stats.holds_released_to = bump_counter(stats.holds_released_to)?;

    emit!(InstantTransfer {
        sender: ctx.accounts.sender.key(),
        recipient: ctx.accounts.recipient.key(),
        mint: NATIVE_SOL_MINT,
        amount,
        timestamp: now,
        tier: tier::TRUSTED,
    });
    Ok(())
}
