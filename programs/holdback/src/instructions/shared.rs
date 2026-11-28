//! Checks and transfers used by more than one instruction.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface,
    TransferChecked,
};

use crate::constants::*;
use crate::errors::HoldbackError;
use crate::state::{Config, Hold};

/// Validates the arguments common to every way of opening a hold and returns
/// `(now, release_at)`.
///
/// `floor_secs` is the shortest window this entry point accepts: the config
/// minimum for sender-signed holds, the config default for relayer-opened
/// ones. A real hold always has a window of at least one second; the
/// zero-window case is the separate instant-transfer instruction.
pub fn validate_new_hold(
    config: &Config,
    amount: u64,
    window_secs: u32,
    floor_secs: u32,
    tier_value: u8,
) -> Result<(i64, i64)> {
    require!(!config.paused, HoldbackError::Paused);
    require!(amount > 0, HoldbackError::ZeroAmount);
    require!(tier_value <= tier::MAX, HoldbackError::InvalidTier);
    require!(
        window_secs >= floor_secs.max(1),
        HoldbackError::WindowTooShort
    );
    require!(
        window_secs <= config.max_window_secs,
        HoldbackError::WindowTooLong
    );
    let now = Clock::get()?.unix_timestamp;
    let release_at = now
        .checked_add(i64::from(window_secs))
        .ok_or(HoldbackError::Overflow)?;
    Ok((now, release_at))
}

/// Requires the hold to be pending and returns the current time.
pub fn require_pending(hold: &Hold) -> Result<i64> {
    require!(
        hold.status == status::PENDING,
        HoldbackError::HoldNotPending
    );
    Ok(Clock::get()?.unix_timestamp)
}

/// Moves the whole vault balance to `destination` and closes the vault,
/// refunding its rent to `rent_destination`. The hold PDA signs.
///
/// Returns the amount moved. Callers constrain `destination` to a token
/// account owned by the hold's sender or recipient; this function does not
/// choose where funds go.
pub fn drain_and_close_vault<'info>(
    hold: &Account<'info, Hold>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    destination: AccountInfo<'info>,
    rent_destination: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<u64> {
    let amount = vault.amount;
    let nonce = hold.nonce.to_le_bytes();
    let bump = [hold.bump];
    let seeds: &[&[u8]] = &[HOLD_SEED, hold.sender.as_ref(), &nonce, &bump];
    let signer = &[seeds];

    transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: destination,
                authority: hold.to_account_info(),
            },
            signer,
        ),
        amount,
        mint.decimals,
    )?;

    close_account(CpiContext::new_with_signer(
        token_program.key(),
        CloseAccount {
            account: vault.to_account_info(),
            destination: rent_destination,
            authority: hold.to_account_info(),
        },
        signer,
    ))?;

    Ok(amount)
}

/// Moves a SOL hold's lamports out of the hold account. The hold keeps its
/// rent, which `close_hold` later refunds to the rent payer.
pub fn pay_out_sol<'info>(
    hold: &Account<'info, Hold>,
    destination: &AccountInfo<'info>,
) -> Result<u64> {
    let amount = hold.amount;
    hold.sub_lamports(amount)?;
    destination.add_lamports(amount)?;
    Ok(amount)
}

/// `a + 1` with an explicit overflow error, for the reputation counters.
pub fn bump_counter(value: u32) -> Result<u32> {
    value.checked_add(1).ok_or(HoldbackError::Overflow.into())
}
