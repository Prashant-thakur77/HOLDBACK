//! Program errors. Messages are written for end users: wallets show them as-is.

use anchor_lang::prelude::*;

#[error_code]
pub enum HoldbackError {
    #[msg("The undo window is longer than the maximum this program allows")]
    WindowTooLong,
    #[msg("The undo window is shorter than the minimum this program allows")]
    WindowTooShort,
    #[msg("An undo window can be extended but never shortened")]
    WindowCannotShrink,
    #[msg("This hold has already been released or reclaimed")]
    HoldNotPending,
    #[msg("The undo window is still running; funds cannot be released yet")]
    WindowNotOver,
    #[msg("The undo window has ended; this action is no longer possible")]
    WindowOver,
    #[msg("The sender has not marked this recipient as trusted")]
    NotTrusted,
    #[msg("This signer is not allowed to perform this action")]
    Unauthorized,
    #[msg("New holds are paused; existing holds can still be reclaimed or released")]
    Paused,
    #[msg("The amount must be greater than zero")]
    ZeroAmount,
    #[msg("The token mint does not match this hold")]
    MintMismatch,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("The risk tier is not a known value")]
    InvalidTier,
    #[msg("The risk tier can be raised but never lowered")]
    TierCannotDrop,
    #[msg("Window settings must satisfy min <= default <= max <= 30 days")]
    InvalidWindowConfig,
    #[msg("Sender and recipient must be different accounts")]
    SelfTransfer,
    #[msg("The flag reason code is not a known value")]
    InvalidReason,
    #[msg("This hold is still pending and cannot be closed")]
    HoldStillPending,
    #[msg("This hold holds native SOL; use the SOL instruction")]
    NotTokenHold,
    #[msg("This hold holds tokens; use the token instruction")]
    NotSolHold,
    #[msg("Mints that take a fee on transfer are not supported")]
    UnsupportedMint,
    #[msg("The amount is too small to keep the recipient account rent-exempt")]
    AmountBelowRentFloor,
    #[msg("The account does not belong to the expected party")]
    WrongParty,
}
