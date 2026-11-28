//! Holds whose window is set by the risk agent, not just reported by it.
//!
//! The risk oracle signs the assessment it gave the sender. The sender's
//! transaction carries that signature as an Ed25519 program instruction placed
//! immediately before the hold instruction. The runtime verifies the
//! signature; this module checks that it was the configured oracle that
//! signed, and that the signed message is exactly this payment:
//!
//! ```text
//! "HOLDBACK_ASSESSMENT_V1" || program id || sender || recipient || mint
//!   || amount (u64 le) || window_secs (u32 le) || tier (u8)
//!   || evidence_hash (32) || expires_at (i64 le)
//! ```
//!
//! The sender may choose a longer window than the attested one, never a
//! shorter one. The hold records `origin = ATTESTED`, so anyone can tell from
//! the account alone that its window was set under the oracle's signature.

use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use super::create_hold::*;
use crate::constants::*;
use crate::errors::HoldbackError;

/// Byte size of the message the oracle signs.
pub const ASSESSMENT_LEN: usize = 22 + 32 * 4 + 8 + 4 + 1 + 32 + 8;

/// The terms of one assessment, as the oracle signs them.
pub struct Assessment {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub window_secs: u32,
    pub tier: u8,
    pub evidence_hash: [u8; 32],
    pub expires_at: i64,
}

impl Assessment {
    /// The exact bytes the oracle signs.
    pub fn message(&self, program_id: &Pubkey) -> Vec<u8> {
        let mut out = Vec::with_capacity(ASSESSMENT_LEN);
        out.extend_from_slice(ASSESSMENT_DOMAIN);
        out.extend_from_slice(program_id.as_ref());
        out.extend_from_slice(self.sender.as_ref());
        out.extend_from_slice(self.recipient.as_ref());
        out.extend_from_slice(self.mint.as_ref());
        out.extend_from_slice(&self.amount.to_le_bytes());
        out.extend_from_slice(&self.window_secs.to_le_bytes());
        out.push(self.tier);
        out.extend_from_slice(&self.evidence_hash);
        out.extend_from_slice(&self.expires_at.to_le_bytes());
        out
    }
}

/// What one Ed25519 program instruction proves: who signed which message.
#[derive(Debug, PartialEq, Eq)]
pub struct SignedMessage<'a> {
    pub signer: Pubkey,
    pub message: &'a [u8],
}

/// Reads a single-signature Ed25519 program instruction whose public key,
/// signature and message all live inside the instruction itself (the layout
/// clients produce). Any other layout is refused rather than interpreted,
/// because offsets that point into other instructions could make the
/// verified bytes differ from the bytes read here.
pub fn parse_ed25519(data: &[u8]) -> Option<SignedMessage<'_>> {
    const HEADER: usize = 2;
    const OFFSETS: usize = 14;
    if data.len() < HEADER + OFFSETS || data[0] != 1 {
        return None;
    }
    let u16_at = |i: usize| u16::from_le_bytes([data[i], data[i + 1]]);
    let o = HEADER;
    let signature_ix = u16_at(o + 2);
    let key_offset = u16_at(o + 4) as usize;
    let key_ix = u16_at(o + 6);
    let message_offset = u16_at(o + 8) as usize;
    let message_size = u16_at(o + 10) as usize;
    let message_ix = u16_at(o + 12);
    if [signature_ix, key_ix, message_ix] != [u16::MAX; 3] {
        return None;
    }
    let key = data.get(key_offset..key_offset.checked_add(32)?)?;
    let message = data.get(message_offset..message_offset.checked_add(message_size)?)?;
    Some(SignedMessage {
        signer: Pubkey::new_from_array(key.try_into().ok()?),
        message,
    })
}

/// Requires that the instruction right before this one is an Ed25519
/// verification of `expected` signed by `oracle`. The runtime has already
/// checked the signature itself when the transaction was accepted.
pub fn require_attestation(
    instructions: &AccountInfo,
    oracle: &Pubkey,
    expected: &[u8],
) -> Result<()> {
    let current = load_current_index_checked(instructions)?;
    require!(current > 0, HoldbackError::MissingAttestation);
    let previous = load_instruction_at_checked((current - 1) as usize, instructions)?;
    require!(
        previous.program_id.to_bytes() == solana_sdk_ids::ed25519_program::ID.to_bytes(),
        HoldbackError::MissingAttestation
    );
    let signed = parse_ed25519(&previous.data).ok_or(HoldbackError::MissingAttestation)?;
    require_keys_eq!(signed.signer, *oracle, HoldbackError::WrongAttester);
    require!(
        signed.message == expected,
        HoldbackError::AttestationMismatch
    );
    Ok(())
}

/// Shared checks for both attested instructions; returns the attested window
/// the hold must respect.
#[allow(clippy::too_many_arguments)]
fn check(
    instructions: &AccountInfo,
    oracle: &Pubkey,
    terms: Assessment,
    window_secs: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now <= terms.expires_at, HoldbackError::AttestationExpired);
    require!(
        window_secs >= terms.window_secs,
        HoldbackError::WindowTooShort
    );
    require_attestation(instructions, oracle, &terms.message(&crate::ID))
}

// No `#[instruction]` here: Anchor would consume the arguments before the
// nested `CreateHold` reads its `nonce` from the same instruction data.
#[derive(Accounts)]
pub struct CreateHoldAttested<'info> {
    pub base: CreateHold<'info>,

    /// CHECK: the instructions sysvar, fixed by address.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID.to_bytes().into())]
    pub instructions: UncheckedAccount<'info>,
}

#[allow(clippy::too_many_arguments)]
pub fn create_token_attested(
    ctx: Context<CreateHoldAttested>,
    nonce: u64,
    amount: u64,
    window_secs: u32,
    attested_window_secs: u32,
    tier: u8,
    evidence_hash: [u8; 32],
    expires_at: i64,
) -> Result<()> {
    let base = &ctx.accounts.base;
    check(
        &ctx.accounts.instructions.to_account_info(),
        &base.config.risk_oracle,
        Assessment {
            sender: base.sender.key(),
            recipient: base.recipient.key(),
            mint: base.mint.key(),
            amount,
            window_secs: attested_window_secs,
            tier,
            evidence_hash,
            expires_at,
        },
        window_secs,
    )?;
    let bumps = ctx.bumps.base;
    open_token_hold(
        &mut ctx.accounts.base,
        &bumps,
        nonce,
        amount,
        window_secs,
        tier,
        evidence_hash,
        origin::ATTESTED,
    )
}

#[derive(Accounts)]
pub struct CreateHoldSolAttested<'info> {
    pub base: CreateHoldSol<'info>,

    /// CHECK: the instructions sysvar, fixed by address.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID.to_bytes().into())]
    pub instructions: UncheckedAccount<'info>,
}

#[allow(clippy::too_many_arguments)]
pub fn create_sol_attested(
    ctx: Context<CreateHoldSolAttested>,
    nonce: u64,
    amount: u64,
    window_secs: u32,
    attested_window_secs: u32,
    tier: u8,
    evidence_hash: [u8; 32],
    expires_at: i64,
) -> Result<()> {
    let base = &ctx.accounts.base;
    check(
        &ctx.accounts.instructions.to_account_info(),
        &base.config.risk_oracle,
        Assessment {
            sender: base.sender.key(),
            recipient: base.recipient.key(),
            mint: NATIVE_SOL_MINT,
            amount,
            window_secs: attested_window_secs,
            tier,
            evidence_hash,
            expires_at,
        },
        window_secs,
    )?;
    let bumps = ctx.bumps.base;
    open_sol_hold(
        &mut ctx.accounts.base,
        &bumps,
        nonce,
        amount,
        window_secs,
        tier,
        evidence_hash,
        origin::ATTESTED,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ed25519_data(key: &[u8; 32], message: &[u8]) -> Vec<u8> {
        let key_offset = 16u16;
        let sig_offset = key_offset + 32;
        let msg_offset = sig_offset + 64;
        let mut data = vec![1u8, 0];
        for v in [
            sig_offset,
            u16::MAX,
            key_offset,
            u16::MAX,
            msg_offset,
            message.len() as u16,
            u16::MAX,
        ] {
            data.extend_from_slice(&v.to_le_bytes());
        }
        data.extend_from_slice(key);
        data.extend_from_slice(&[0u8; 64]);
        data.extend_from_slice(message);
        data
    }

    #[test]
    fn parses_the_client_layout() {
        let key = [7u8; 32];
        let data = ed25519_data(&key, b"hello");
        let parsed = parse_ed25519(&data).unwrap();
        assert_eq!(parsed.signer, Pubkey::new_from_array(key));
        assert_eq!(parsed.message, b"hello");
    }

    #[test]
    fn refuses_offsets_into_other_instructions_and_short_data() {
        let mut data = ed25519_data(&[1u8; 32], b"x");
        data[4] = 0; // signature instruction index -> 0
        data[5] = 0;
        assert!(parse_ed25519(&data).is_none());
        assert!(parse_ed25519(&[1, 0, 0]).is_none());
        let mut two = ed25519_data(&[1u8; 32], b"x");
        two[0] = 2;
        assert!(parse_ed25519(&two).is_none());
    }

    #[test]
    fn message_layout_is_fixed() {
        let terms = Assessment {
            sender: Pubkey::new_from_array([1; 32]),
            recipient: Pubkey::new_from_array([2; 32]),
            mint: Pubkey::new_from_array([3; 32]),
            amount: 5,
            window_secs: 1800,
            tier: 2,
            evidence_hash: [9; 32],
            expires_at: 1_800_000_000,
        };
        let message = terms.message(&Pubkey::new_from_array([4; 32]));
        assert_eq!(message.len(), ASSESSMENT_LEN);
        assert!(message.starts_with(ASSESSMENT_DOMAIN));
        assert_eq!(
            &message[message.len() - 8..],
            &1_800_000_000i64.to_le_bytes()
        );
    }
}
