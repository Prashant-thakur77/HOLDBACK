use anchor_lang::prelude::*;

use super::shared::bump_counter;
use crate::constants::*;
use crate::errors::HoldbackError;
use crate::events::SubjectFlagged;
use crate::state::{Flag, SubjectStats};

#[derive(Accounts)]
pub struct FlagSubject<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,

    /// CHECK: the address being reported; only stored and used as a seed.
    #[account(constraint = subject.key() != reporter.key() @ HoldbackError::SelfTransfer)]
    pub subject: UncheckedAccount<'info>,

    /// `init` makes a second flag by the same reporter fail.
    #[account(
        init,
        payer = reporter,
        space = 8 + Flag::INIT_SPACE,
        seeds = [FLAG_SEED, reporter.key().as_ref(), subject.key().as_ref()],
        bump,
    )]
    pub flag: Box<Account<'info, Flag>>,

    #[account(
        init_if_needed,
        payer = reporter,
        space = 8 + SubjectStats::INIT_SPACE,
        seeds = [STATS_SEED, subject.key().as_ref()],
        bump,
    )]
    pub subject_stats: Box<Account<'info, SubjectStats>>,

    pub system_program: Program<'info, System>,
}

pub fn flag(ctx: Context<FlagSubject>, reason: u8, evidence_hash: [u8; 32]) -> Result<()> {
    require!(reason <= MAX_FLAG_REASON, HoldbackError::InvalidReason);
    let now = Clock::get()?.unix_timestamp;

    let flag = &mut ctx.accounts.flag;
    flag.reporter = ctx.accounts.reporter.key();
    flag.subject = ctx.accounts.subject.key();
    flag.reason = reason;
    flag.evidence_hash = evidence_hash;
    flag.created_at = now;
    flag.bump = ctx.bumps.flag;

    let stats = &mut ctx.accounts.subject_stats;
    stats.touch(flag.subject, ctx.bumps.subject_stats);
    stats.flags = bump_counter(stats.flags)?;

    emit!(SubjectFlagged {
        reporter: flag.reporter,
        subject: flag.subject,
        reason,
        evidence_hash,
        total_flags: stats.flags,
        timestamp: now,
    });
    Ok(())
}
