//! Events. Indexers rebuild the full state of every hold from these alone.

use anchor_lang::prelude::*;

#[event]
pub struct HoldCreated {
    pub hold: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub created_at: i64,
    pub release_at: i64,
    pub tier: u8,
    pub origin: u8,
    pub evidence_hash: [u8; 32],
    pub nonce: u64,
}

#[event]
pub struct InstantTransfer {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub tier: u8,
}

#[event]
pub struct WindowExtended {
    pub hold: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub old_release_at: i64,
    pub new_release_at: i64,
    pub timestamp: i64,
    pub tier: u8,
    pub evidence_hash: [u8; 32],
}

#[event]
pub struct HoldReclaimed {
    pub hold: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub tier: u8,
    pub by: Pubkey,
}

#[event]
pub struct HoldReleased {
    pub hold: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub tier: u8,
    /// True when the sender released before the window ended.
    pub early: bool,
}

#[event]
pub struct TrustSet {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TrustRemoved {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SubjectFlagged {
    pub reporter: Pubkey,
    pub subject: Pubkey,
    pub reason: u8,
    pub evidence_hash: [u8; 32],
    pub total_flags: u32,
    pub timestamp: i64,
}

#[event]
pub struct DepositBoxOpened {
    pub deposit_box: Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DepositWithdrawn {
    pub deposit_box: Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub by: Pubkey,
}
