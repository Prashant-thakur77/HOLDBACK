/**
 * Signs an assessment with the risk-oracle key so the program can enforce it.
 *
 * The sender's transaction carries this signature as an Ed25519 instruction
 * before `create_hold_attested`; the program refuses the hold unless the
 * configured oracle signed exactly these terms and the window is at least the
 * signed one. Without an oracle key no attestation is returned and clients use
 * the plain `create_hold`.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { PublicKey } from '@solana/web3.js';
import { assessmentMessage, fromHex, toHex, type Attestation } from '@holdback/sdk';

import type { Subject } from '../collectors/types';
import type { Env } from '../env';
import { loadKeypair } from '../lib/keys';

/** How long a signed assessment stays usable. */
export const ATTESTATION_TTL_SECS = 600;

export function attest(
  env: Env,
  subject: Subject,
  terms: { windowSecs: number; tier: number; evidenceHash: string },
  now: Date,
): Attestation | undefined {
  // A zero window is the trusted instant path, which needs no hold at all.
  if (terms.windowSecs <= 0) return undefined;
  const oracle = loadKeypair(env, 'ORACLE_KEYPAIR');
  if (!oracle) return undefined;
  let message: Uint8Array;
  const expiresAt = Math.floor(now.getTime() / 1000) + ATTESTATION_TTL_SECS;
  try {
    message = assessmentMessage({
      sender: new PublicKey(subject.sender),
      recipient: new PublicKey(subject.recipient),
      mint: subject.mint ? new PublicKey(subject.mint) : null,
      amount: subject.amount,
      windowSecs: terms.windowSecs,
      tier: terms.tier,
      evidenceHash: fromHex(terms.evidenceHash),
      expiresAt,
    });
  } catch {
    return undefined;
  }
  const signature = ed25519.sign(message, oracle.secretKey.subarray(0, 32));
  return {
    oracle: oracle.publicKey.toBase58(),
    signature: toHex(signature),
    windowSecs: terms.windowSecs,
    tier: terms.tier,
    evidenceHash: terms.evidenceHash,
    expiresAt,
  };
}
