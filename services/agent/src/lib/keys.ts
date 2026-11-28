/**
 * The three signing keys. Each is read from a secret, accepted as base58
 * or as the JSON byte array `solana-keygen` writes, and never logged: error
 * messages name the variable, not its value.
 */
import { Keypair } from '@solana/web3.js';

import type { Env } from '../env';
import { unavailable } from '../errors';
import { decodeBase58 } from './encoding';

export type KeyName = 'ORACLE_KEYPAIR' | 'RELAYER_KEYPAIR' | 'CRANK_KEYPAIR' | 'FAUCET_KEYPAIR';

export function parseKeypair(text: string): Keypair {
  const trimmed = text.trim();
  const bytes = trimmed.startsWith('[')
    ? Uint8Array.from(JSON.parse(trimmed) as number[])
    : decodeBase58(trimmed);
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error('A keypair must be 64 bytes (or a 32-byte seed)');
}

/** The keypair for `name`, or `null` when the secret is not set. */
export function loadKeypair(env: Env, name: KeyName): Keypair | null {
  const value = env[name];
  if (!value) return null;
  try {
    return parseKeypair(value);
  } catch {
    throw unavailable(`${name} is set but is not a valid keypair`, 'key_invalid');
  }
}

export function requireKeypair(env: Env, name: KeyName): Keypair {
  const keypair = loadKeypair(env, name);
  if (!keypair) throw unavailable(`${name} is not configured`, 'key_unavailable');
  return keypair;
}
