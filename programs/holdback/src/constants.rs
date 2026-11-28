//! Seeds, enumerated byte values and hard limits shared by every instruction.

use anchor_lang::prelude::*;

/// Seed of the singleton [`crate::state::Config`] account.
pub const CONFIG_SEED: &[u8] = b"config";
/// Seed prefix of a [`crate::state::Hold`]: `["hold", sender, nonce_le_u64]`.
pub const HOLD_SEED: &[u8] = b"hold";
/// Seed prefix of a [`crate::state::Trust`]: `["trust", sender, recipient]`.
pub const TRUST_SEED: &[u8] = b"trust";
/// Seed prefix of a [`crate::state::DepositBox`]: `["box", owner]`.
pub const BOX_SEED: &[u8] = b"box";
/// Seed prefix of a [`crate::state::Flag`]: `["flag", reporter, subject]`.
pub const FLAG_SEED: &[u8] = b"flag";
/// Seed prefix of a [`crate::state::SubjectStats`]: `["stats", subject]`.
pub const STATS_SEED: &[u8] = b"stats";

/// Risk tiers assigned by the risk agent's deterministic policy.
pub mod tier {
    /// The sender explicitly trusts the recipient, or has a clean history with them.
    pub const TRUSTED: u8 = 0;
    /// No evidence either way; the default window applies.
    pub const UNKNOWN: u8 = 1;
    /// Some evidence of risk.
    pub const SUSPICIOUS: u8 = 2;
    /// Strong evidence or a confirmed scam report.
    pub const FLAGGED: u8 = 3;
    /// The recipient is on a sanctions list.
    pub const SANCTIONED: u8 = 4;
    /// Highest valid tier value.
    pub const MAX: u8 = SANCTIONED;
}

/// Where the held funds came from.
pub mod origin {
    /// The sender signed `create_hold` from their own wallet.
    pub const WALLET: u8 = 0;
    /// The relayer moved funds out of the sender's deposit box.
    pub const DEPOSIT_BOX: u8 = 1;
    /// The sender signed, and the window, tier and evidence hash carry the
    /// risk oracle's signature, checked on-chain (`create_hold_attested`).
    pub const ATTESTED: u8 = 2;
}

/// Domain tag at the start of every assessment the risk oracle signs.
pub const ASSESSMENT_DOMAIN: &[u8] = b"HOLDBACK_ASSESSMENT_V1";

/// Lifecycle of a hold. `PENDING` is the only non-terminal state.
pub mod status {
    /// Funds are in the vault and the window is running.
    pub const PENDING: u8 = 0;
    /// Funds went to the recipient.
    pub const RELEASED: u8 = 1;
    /// Funds went back to the sender.
    pub const RECLAIMED: u8 = 2;
}

/// Highest accepted `reason` code for `flag_subject`.
///
/// 0 other, 1 phishing, 2 impersonation, 3 investment fraud, 4 romance,
/// 5 fake support, 6 drainer, 7 extortion.
pub const MAX_FLAG_REASON: u8 = 7;

/// Absolute ceiling for `Config::max_window_secs` (30 days). The admin cannot
/// configure windows that lock funds for longer than this.
pub const WINDOW_HARD_CAP_SECS: u32 = 30 * 24 * 60 * 60;

/// `Hold::mint` value that marks a native SOL hold.
pub const NATIVE_SOL_MINT: Pubkey = Pubkey::new_from_array([0u8; 32]);
