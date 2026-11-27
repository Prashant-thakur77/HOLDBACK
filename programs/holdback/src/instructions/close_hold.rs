use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HoldbackError;
use crate::state::Hold;

/// Permissionless: the rent can only go to the recorded rent payer, so it
/// does not matter who sends the transaction.
#[derive(Accounts)]
pub struct CloseHold<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        close = rent_payer,
        seeds = [HOLD_SEED, hold.sender.as_ref(), &hold.nonce.to_le_bytes()],
        bump = hold.bump,
        constraint = hold.status != status::PENDING @ HoldbackError::HoldStillPending,
    )]
    pub hold: Box<Account<'info, Hold>>,

    /// CHECK: receives the hold's rent; must be the recorded rent payer.
    #[account(mut, address = hold.rent_payer @ HoldbackError::WrongParty)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn close(_ctx: Context<CloseHold>) -> Result<()> {
    Ok(())
}
