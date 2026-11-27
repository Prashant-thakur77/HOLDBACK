use anchor_lang::prelude::*;

use super::shared::require_pending;
use crate::constants::*;
use crate::errors::HoldbackError;
use crate::events::WindowExtended;
use crate::state::{Config, Hold};

/// The oracle signs and the hold is the only writable account. No token
/// account, vault or system transfer is reachable from here, so the oracle
/// key cannot move funds whatever it signs.
#[derive(Accounts)]
pub struct ExtendWindow<'info> {
    pub risk_oracle: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = risk_oracle @ HoldbackError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [HOLD_SEED, hold.sender.as_ref(), &hold.nonce.to_le_bytes()],
        bump = hold.bump,
    )]
    pub hold: Box<Account<'info, Hold>>,
}

pub fn extend(
    ctx: Context<ExtendWindow>,
    new_release_at: i64,
    tier: u8,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let config = &ctx.accounts.config;
    let hold = &mut ctx.accounts.hold;

    let now = require_pending(hold)?;
    // Once the window is over the recipient is entitled to the funds; the
    // oracle cannot re-lock them.
    require!(now < hold.release_at, HoldbackError::WindowOver);
    require!(tier <= tier::MAX, HoldbackError::InvalidTier);
    require!(tier >= hold.tier, HoldbackError::TierCannotDrop);
    require!(
        new_release_at >= hold.release_at,
        HoldbackError::WindowCannotShrink
    );
    let latest = hold
        .created_at
        .checked_add(i64::from(config.max_window_secs))
        .ok_or(HoldbackError::Overflow)?;
    require!(new_release_at <= latest, HoldbackError::WindowTooLong);

    let old_release_at = hold.release_at;
    hold.release_at = new_release_at;
    hold.tier = tier;
    hold.evidence_hash = evidence_hash;

    emit!(WindowExtended {
        hold: hold.key(),
        sender: hold.sender,
        recipient: hold.recipient,
        mint: hold.mint,
        amount: hold.amount,
        old_release_at,
        new_release_at,
        timestamp: now,
        tier,
        evidence_hash,
    });
    Ok(())
}
