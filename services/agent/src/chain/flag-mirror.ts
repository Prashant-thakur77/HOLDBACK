/**
 * Optional on-chain mirror of off-chain reports. The program allows one
 * flag per reporter per subject, so the service, reporting with the crank
 * key, can add exactly one on-chain flag to any address however many
 * captcha-passing reports arrive. It does so only once enough reports
 * exist.
 */
import { sha256 } from '@noble/hashes/sha256';
import { PublicKey } from '@solana/web3.js';
import { canonicalJson, flagPda, instructions, toHex } from '@holdback/sdk';

import { countOffchainFlags, markFlagMirrored } from '../db/flags';
import { flag as enabled, numberVar } from '../env';
import { utf8 } from '../lib/encoding';
import { loadKeypair } from '../lib/keys';
import { sendAndConfirm } from '../lib/solana';
import type { Services } from '../services';

/** Reports needed before the service flags an address on-chain. */
export const DEFAULT_MIRROR_MIN_REPORTS = 3;

/** Mirrors the report `flagId` on-chain if enabled and warranted. Returns the signature, if any. */
export async function mirrorFlag(
  services: Services,
  flagId: string,
  subject: string,
  reason: number,
): Promise<string | null> {
  const { env, db, cluster, programId } = services;
  if (!db || !enabled(env.FLAG_MIRROR_ONCHAIN)) return null;
  const crank = loadKeypair(env, 'CRANK_KEYPAIR');
  if (!crank) return null;

  const reports = await countOffchainFlags(db, subject);
  if (reports < numberVar(env.FLAG_MIRROR_MIN_REPORTS, DEFAULT_MIRROR_MIN_REPORTS)) return null;

  const subjectKey = new PublicKey(subject);
  const existing = await cluster.getAccountInfo(flagPda(crank.publicKey, subjectKey, programId));
  if (existing) return null;

  const evidenceHash = sha256(utf8(canonicalJson({ subject, reason, reports, flagId })));
  const signature = await sendAndConfirm(cluster, crank, [
    instructions.flagSubject({
      reporter: crank.publicKey,
      subject: subjectKey,
      reason,
      evidenceHash,
      programId,
    }),
  ]);
  await markFlagMirrored(db, flagId, toHex(evidenceHash), signature);
  return signature;
}
