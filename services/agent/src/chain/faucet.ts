/**
 * A small devnet faucet for the "Try it" page.
 *
 * A visitor gets a throwaway wallet in the browser; this pays it enough devnet
 * SOL for one protected payment and its undo. The faucet key is its own key:
 * it holds only devnet SOL and has no role in the program. Three limits keep
 * it from being drained: one grant per address per day, the per-IP
 * rate-limiting binding on the route, and a daily total.
 */
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

import { ApiError, unavailable } from '../errors';
import { loadKeypair } from '../lib/keys';
import type { Services } from '../services';

export const FAUCET_LAMPORTS = 0.02 * LAMPORTS_PER_SOL;
export const DEFAULT_DAILY_GRANTS = 200;
const DAY_SECS = 86_400;

export interface FaucetGrant {
  address: string;
  lamports: number;
  signature: string;
}

/** `2026-11-29` for a date, the key of the daily counter. */
export const dayKey = (now: Date) => now.toISOString().slice(0, 10);

export async function grant(
  services: Services,
  address: string,
  now = new Date(),
): Promise<FaucetGrant> {
  const faucet = loadKeypair(services.env, 'FAUCET_KEYPAIR');
  if (!faucet) throw unavailable('The devnet faucet is not configured', 'faucet_unavailable');

  let recipient: PublicKey;
  try {
    recipient = new PublicKey(address);
  } catch {
    throw new ApiError(400, 'invalid_address', 'Not a Solana address');
  }

  const already = await services.cache.get<string>('faucet', recipient.toBase58());
  if (already) {
    throw new ApiError(429, 'already_funded', 'This address was already funded today');
  }
  const limit = Number(services.env.FAUCET_DAILY_GRANTS ?? DEFAULT_DAILY_GRANTS);
  const today = dayKey(now);
  const used = (await services.cache.get<number>('faucet_day', today)) ?? 0;
  if (used >= limit) {
    throw new ApiError(429, 'faucet_empty', 'The faucet has given out today’s devnet SOL');
  }

  const signature = await sendAndConfirmTransaction(
    services.cluster,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: faucet.publicKey,
        toPubkey: recipient,
        lamports: FAUCET_LAMPORTS,
      }),
    ),
    [faucet],
    { commitment: 'confirmed' },
  );
  await Promise.all([
    services.cache.set('faucet', recipient.toBase58(), signature, DAY_SECS),
    services.cache.set('faucet_day', today, used + 1, DAY_SECS),
  ]);
  return { address: recipient.toBase58(), lamports: FAUCET_LAMPORTS, signature };
}
