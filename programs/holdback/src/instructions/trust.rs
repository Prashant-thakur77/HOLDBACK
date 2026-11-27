use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HoldbackError;
use crate::events::{TrustRemoved, TrustSet};
use crate::state::Trust;

#[derive(Accounts)]
pub struct SetTrust<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: the address being trusted; only used as a seed.
    #[account(constraint = recipient.key() != sender.key() @ HoldbackError::SelfTransfer)]
    pub recipient: UncheckedAccount<'info>,

    #[account(
        init,
        payer = sender,
        space = 8 + Trust::INIT_SPACE,
        seeds = [TRUST_SEED, sender.key().as_ref(), recipient.key().as_ref()],
        bump,
    )]
    pub trust: Box<Account<'info, Trust>>,

    pub system_program: Program<'info, System>,
}

pub fn set_trust(ctx: Context<SetTrust>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let trust = &mut ctx.accounts.trust;
    trust.sender = ctx.accounts.sender.key();
    trust.recipient = ctx.accounts.recipient.key();
    trust.created_at = now;
    trust.bump = ctx.bumps.trust;

    emit!(TrustSet {
        sender: trust.sender,
        recipient: trust.recipient,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RemoveTrust<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: the address no longer trusted; only used as a seed.
    pub recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        close = sender,
        seeds = [TRUST_SEED, sender.key().as_ref(), recipient.key().as_ref()],
        bump = trust.bump,
        has_one = sender @ HoldbackError::Unauthorized,
    )]
    pub trust: Box<Account<'info, Trust>>,
}

pub fn remove_trust(ctx: Context<RemoveTrust>) -> Result<()> {
    emit!(TrustRemoved {
        sender: ctx.accounts.sender.key(),
        recipient: ctx.accounts.recipient.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
