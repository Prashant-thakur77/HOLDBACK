/**
 * Risk-oracle attestations.
 *
 * The Guardian signs each assessment it gives with the oracle key. A hold
 * created with `create_hold_attested` carries that signature as an Ed25519
 * program instruction right before the hold instruction, and the program
 * checks that the configured oracle signed exactly this payment's terms. The
 * byte layout below must match `Assessment::message` in the program.
 */
import { Ed25519Program, PublicKey, type TransactionInstruction } from '@solana/web3.js';

import { NATIVE_SOL_MINT, PROGRAM_ID } from './constants';

export const ASSESSMENT_DOMAIN = 'HOLDBACK_ASSESSMENT_V1';
/** Byte length of a signed assessment. */
export const ASSESSMENT_LEN = 22 + 32 * 4 + 8 + 4 + 1 + 32 + 8;

/** The terms the oracle signs. */
export interface AssessmentTerms {
  sender: PublicKey;
  recipient: PublicKey;
  /** `null` for native SOL. */
  mint: PublicKey | null;
  amount: bigint;
  windowSecs: number;
  tier: number;
  evidenceHash: Uint8Array;
  /** Unix seconds after which the program refuses the attestation. */
  expiresAt: number;
}

/** An assessment as the Guardian returns it, JSON-safe. */
export interface Attestation {
  /** The oracle public key that signed (base58). */
  oracle: string;
  /** Ed25519 signature over `assessmentMessage(...)`, hex. */
  signature: string;
  windowSecs: number;
  tier: number;
  /** Hex sha256 of the evidence document. */
  evidenceHash: string;
  expiresAt: number;
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let rest = BigInt.asUintN(64, value);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/** The exact bytes the oracle signs for `terms`. */
export function assessmentMessage(
  terms: AssessmentTerms,
  programId: PublicKey = PROGRAM_ID,
): Uint8Array {
  if (terms.evidenceHash.length !== 32) throw new Error('evidenceHash must be 32 bytes');
  const window = new Uint8Array(4);
  new DataView(window.buffer).setUint32(0, terms.windowSecs, true);
  const parts = [
    new TextEncoder().encode(ASSESSMENT_DOMAIN),
    programId.toBytes(),
    terms.sender.toBytes(),
    terms.recipient.toBytes(),
    (terms.mint ?? NATIVE_SOL_MINT).toBytes(),
    u64le(terms.amount),
    window,
    Uint8Array.of(terms.tier),
    terms.evidenceHash,
    u64le(BigInt(terms.expiresAt)),
  ];
  const out = new Uint8Array(ASSESSMENT_LEN);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The Ed25519 program instruction that carries the oracle's signature. */
export function attestationInstruction(
  oracle: PublicKey,
  signature: Uint8Array,
  message: Uint8Array,
): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: oracle.toBytes(),
    message,
    signature,
  });
}

/**
 * The attestation in `assessment` if it was issued for exactly this payment,
 * otherwise `undefined` (the caller then creates a plain hold). An
 * attestation for other terms would be refused on-chain, so this check stops
 * a stale assessment from breaking the payment.
 */
export function attestationFor(
  assessment: {
    attestation?: Attestation;
    document: { sender: string; recipient: string; mint: string; amount: string };
  },
  payment: { sender: PublicKey; recipient: PublicKey; mint: PublicKey | null; amount: bigint },
): Attestation | undefined {
  const { attestation, document } = assessment;
  if (!attestation) return undefined;
  const mint = payment.mint ? payment.mint.toBase58() : 'SOL';
  const same =
    document.sender === payment.sender.toBase58() &&
    document.recipient === payment.recipient.toBase58() &&
    document.mint === mint &&
    document.amount === payment.amount.toString();
  return same && attestation.expiresAt * 1000 > Date.now() ? attestation : undefined;
}
