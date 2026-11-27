/**
 * Environment parsing for the binary. Kept apart from the server so the
 * server can be built from injected dependencies in tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';

export interface Config {
  rpcUrl: string;
  /** Base URL of the Guardian risk service, or `null` when not configured. */
  guardianUrl: string | null;
  /** The wallet this server may sign with, or `null` for unsigned-transaction mode. */
  signer: Keypair | null;
  /** Per-payment cap as a decimal string in display units, or `null` for no cap. */
  maxAmount: string | null;
}

/** Every message here names the variable and never repeats its value. */
export class ConfigError extends Error {}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function httpUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`${name} must be an http(s) URL`);
  }
  return value;
}

function keypairFromBytes(bytes: Uint8Array): Keypair {
  if (bytes.length !== 64) throw new Error('wrong length');
  return Keypair.fromSecretKey(bytes);
}

/**
 * Accepts a path to a Solana CLI keypair file (a JSON array of 64 numbers)
 * or a base58-encoded 64-byte secret key. Failures are reported without the
 * value, so a mistyped secret can never end up in a log or an error.
 */
export function loadKeypair(value: string): Keypair {
  const path = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  try {
    if (existsSync(path)) {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('not an array');
      return keypairFromBytes(Uint8Array.from(parsed as number[]));
    }
    return keypairFromBytes(bs58.decode(value));
  } catch {
    throw new ConfigError(
      'HOLDBACK_KEYPAIR is set but is neither a readable keypair file nor a base58 secret key',
    );
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const rpcUrl = httpUrl('HOLDBACK_RPC_URL', clean(env.HOLDBACK_RPC_URL) ?? DEFAULT_RPC_URL);

  const guardian = clean(env.HOLDBACK_GUARDIAN_URL);
  const guardianUrl = guardian ? httpUrl('HOLDBACK_GUARDIAN_URL', guardian) : null;

  const keypair = clean(env.HOLDBACK_KEYPAIR);
  const signer = keypair ? loadKeypair(keypair) : null;

  const maxAmount = clean(env.HOLDBACK_MAX_AMOUNT);
  if (maxAmount !== null && (!/^\d+(\.\d+)?$/.test(maxAmount) || Number(maxAmount) <= 0)) {
    throw new ConfigError('HOLDBACK_MAX_AMOUNT must be a positive decimal number such as 250');
  }

  return { rpcUrl, guardianUrl, signer, maxAmount };
}
