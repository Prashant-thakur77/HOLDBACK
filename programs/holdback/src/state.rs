//! Account layouts. Every account is a PDA and stores its own bump.

use anchor_lang::prelude::*;

use crate::constants::NATIVE_SOL_MINT;

/// Singleton program configuration. Seeds: `["config"]`.
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// May update this account. Set to the program's upgrade authority at init.
    pub admin: Pubkey,
    /// Service key that may act for deposit-box owners, within the limits
    /// enforced by `open_hold_from_deposit`, `withdraw_deposit` and `reclaim`.
    pub relayer: Pubkey,
    /// Service key that may extend (never shorten) a pending hold's window.
    pub risk_oracle: Pubkey,
    /// Shortest window a hold may have. `0` enables the trusted instant path.
    pub min_window_secs: u32,
    /// Window used when nothing is known about the recipient. Also the floor
    /// for holds opened by the relayer from a deposit box.
    pub default_window_secs: u32,
    /// Longest window a hold may ever reach, measured from `created_at`.
    pub max_window_secs: u32,
    /// Emergency stop for new holds. Reclaim, release and close keep working.
    pub paused: bool,
    pub bump: u8,
}

/// One protected payment. Seeds: `["hold", sender, nonce_le_u64]`.
///
/// Token holds keep the funds in an associated token account owned by this
/// PDA. SOL holds keep the lamports in this account itself, above rent.
#[account]
#[derive(InitSpace)]
pub struct Hold {
    /// Who paid and who alone can get the money back before `release_at`.
    pub sender: Pubkey,
    /// Who receives the money once the window is over.
    pub recipient: Pubkey,
    /// Token mint, or [`NATIVE_SOL_MINT`] for a SOL hold.
    pub mint: Pubkey,
    /// Amount held, in the mint's base units (lamports for SOL).
    pub amount: u64,
    /// Unix time the hold was created.
    pub created_at: i64,
    /// Unix time from which anyone may release the funds to the recipient.
    pub release_at: i64,
    /// Risk tier, see [`crate::constants::tier`].
    pub tier: u8,
    /// sha256 of the canonical evidence JSON that justified the window.
    pub evidence_hash: [u8; 32],
    /// See [`crate::constants::origin`].
    pub origin: u8,
    /// See [`crate::constants::status`].
    pub status: u8,
    /// Paid the rent for this account and its vault; gets it back on close.
    pub rent_payer: Pubkey,
    /// Sender-chosen nonce that makes the PDA unique.
    pub nonce: u64,
    pub bump: u8,
}

impl Hold {
    /// True when the funds are native SOL kept in the hold account itself.
    pub fn is_sol(&self) -> bool {
        self.mint == NATIVE_SOL_MINT
    }
}

/// "The sender trusts this recipient". Existence is the whole signal.
/// Seeds: `["trust", sender, recipient]`.
#[account]
#[derive(InitSpace)]
pub struct Trust {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub created_at: i64,
    pub bump: u8,
}

/// A program-owned inbox for a wallet that cannot sign program instructions
/// itself (a seedless embedded wallet). The owner sends tokens to the box's
/// associated token account; the relayer can then only return them to the
/// owner or open a hold whose sender is the owner. Seeds: `["box", owner]`.
#[account]
#[derive(InitSpace)]
pub struct DepositBox {
    pub owner: Pubkey,
    pub bump: u8,
}

/// One scam report by one reporter about one subject.
/// Seeds: `["flag", reporter, subject]`, so a reporter can flag a subject once.
#[account]
#[derive(InitSpace)]
pub struct Flag {
    pub reporter: Pubkey,
    pub subject: Pubkey,
    pub reason: u8,
    pub evidence_hash: [u8; 32],
    pub created_at: i64,
    pub bump: u8,
}

/// On-chain reputation of an address as a payment recipient.
/// Seeds: `["stats", subject]`.
///
/// `holds_reclaimed_against` counts how often senders pulled money back from
/// this address. The risk agent reads it as a scam signal.
#[account]
#[derive(InitSpace)]
pub struct SubjectStats {
    pub subject: Pubkey,
    pub flags: u32,
    pub holds_received: u32,
    pub holds_reclaimed_against: u32,
    pub holds_released_to: u32,
    pub bump: u8,
}

impl SubjectStats {
    /// Fills in identity fields the first time the account is used.
    pub fn touch(&mut self, subject: Pubkey, bump: u8) {
        if self.subject == Pubkey::default() {
            self.subject = subject;
            self.bump = bump;
        }
    }
}
