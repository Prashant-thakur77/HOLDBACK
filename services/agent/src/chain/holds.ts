/** Reading holds and mints from the chain, which is always the authority. */
import { PublicKey } from '@solana/web3.js';
import {
  HoldStatus,
  accountDiscriminator,
  decodeHold,
  encodeBase58,
  fetchHold,
  getMintInfo,
  type Hold,
  type MintInfo,
} from '@holdback/sdk';

import { notFound } from '../errors';
import type { Services } from '../services';

/**
 * Byte offset of `Hold.status`: 8 (discriminator) + sender, recipient and
 * mint (32 each) + amount, created_at and release_at (8 each) + tier (1) +
 * evidence_hash (32) + origin (1).
 */
const HOLD_STATUS_OFFSET = 8 + 32 * 3 + 8 * 3 + 1 + 32 + 1;

export async function requireHold(services: Services, pda: PublicKey): Promise<Hold> {
  const hold = await fetchHold(services.cluster, pda, { programId: services.programId });
  if (!hold) throw notFound('No such hold on-chain');
  return hold;
}

/** Every open hold account with the given status. */
export async function holdsWithStatus(services: Services, status: HoldStatus): Promise<Hold[]> {
  const accounts = await services.cluster.getProgramAccounts(services.programId, {
    filters: [
      { memcmp: { offset: 0, bytes: encodeBase58(accountDiscriminator('Hold')) } },
      { memcmp: { offset: HOLD_STATUS_OFFSET, bytes: encodeBase58(Uint8Array.of(status)) } },
    ],
  });
  return accounts.map(({ pubkey, account }) => decodeHold(pubkey, account.data));
}

const mints = new Map<string, MintInfo>();

/** A mint's token program and decimals. These never change, so they are kept per isolate. */
export async function mintInfo(services: Services, mint: PublicKey): Promise<MintInfo> {
  const key = mint.toBase58();
  const known = mints.get(key);
  if (known) return known;
  const info = await getMintInfo(services.cluster, mint);
  mints.set(key, info);
  return info;
}
