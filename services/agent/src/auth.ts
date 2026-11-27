/**
 * Who is calling. Three tokens exist, all HS256:
 *  - a sign-in challenge (short-lived, proves the server issued the nonce),
 *  - a wallet session, minted after an ed25519 signature and signed with the
 *    Supabase JWT secret so Supabase accepts it for Realtime under RLS,
 *  - a relay session, minted after a proof-by-transfer.
 * The last two both carry the claim `wallet`.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { PublicKey } from '@solana/web3.js';

import type { Env } from './env';
import { unauthorized, unavailable } from './errors';
import { base64ToBytes, decodeBase58, randomHex, utf8 } from './lib/encoding';
import { signJwt, verifyJwt } from './lib/jwt';

export const CHALLENGE_TTL_SECS = 5 * 60;
export const WALLET_SESSION_TTL_SECS = 24 * 3_600;
export const RELAY_SESSION_TTL_SECS = 12 * 3_600;

const nowSecs = () => Math.floor(Date.now() / 1000);

function sessionSecret(env: Env): string {
  if (!env.SESSION_JWT_SECRET) {
    throw unavailable('SESSION_JWT_SECRET is not configured', 'auth_unavailable');
  }
  return env.SESSION_JWT_SECRET;
}

/** The exact text a wallet signs. Rebuilt on the server from the challenge, never taken from the client. */
export function signInMessage(wallet: string, nonce: string, expiresAt: string): string {
  return [
    'HOLDBACK wants you to sign in with your Solana account:',
    wallet,
    '',
    'Sign in to HOLDBACK. This request does not move any funds.',
    '',
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt}`,
  ].join('\n');
}

export interface SignInChallenge {
  wallet: string;
  message: string;
  /** Opaque; send it back with the signature. */
  challenge: string;
  expiresAt: string;
}

export async function createChallenge(env: Env, wallet: string): Promise<SignInChallenge> {
  const exp = nowSecs() + CHALLENGE_TTL_SECS;
  const nonce = randomHex(16);
  const expiresAt = new Date(exp * 1000).toISOString();
  return {
    wallet,
    message: signInMessage(wallet, nonce, expiresAt),
    challenge: await signJwt({ scope: 'challenge', wallet, nonce, exp }, sessionSecret(env)),
    expiresAt,
  };
}

/** Accepts a signature as base58 (wallet adapters) or base64 (Mobile Wallet Adapter). */
export function decodeSignature(signature: string): Uint8Array | null {
  for (const decode of [decodeBase58, base64ToBytes]) {
    try {
      const bytes = decode(signature);
      if (bytes.length === 64) return bytes;
    } catch {
      // Try the next encoding.
    }
  }
  return null;
}

/** True when `signature` is the wallet's ed25519 signature over `message`. */
export function verifyWalletSignature(wallet: string, message: string, signature: string): boolean {
  const bytes = decodeSignature(signature);
  if (!bytes) return false;
  try {
    return ed25519.verify(bytes, utf8(message), new PublicKey(wallet).toBytes());
  } catch {
    return false;
  }
}

export interface Session {
  token: string;
  wallet: string;
  expiresAt: string;
}

/**
 * Checks the challenge and the signature and mints the wallet session.
 * Returns the nonce too, so the caller can refuse to accept it twice.
 */
export async function createWalletSession(
  env: Env,
  wallet: string,
  challenge: string,
  signature: string,
): Promise<Session & { nonce: string }> {
  if (!env.SUPABASE_JWT_SECRET) {
    throw unavailable('SUPABASE_JWT_SECRET is not configured', 'auth_unavailable');
  }
  const claims = await verifyJwt(challenge, sessionSecret(env));
  if (!claims || claims.scope !== 'challenge' || claims.wallet !== wallet) {
    throw unauthorized('The sign-in challenge is invalid or has expired');
  }
  const expiresAt = new Date(claims.exp * 1000).toISOString();
  const message = signInMessage(wallet, String(claims.nonce), expiresAt);
  if (!verifyWalletSignature(wallet, message, signature)) {
    throw unauthorized('The signature does not match this wallet');
  }
  const exp = nowSecs() + WALLET_SESSION_TTL_SECS;
  // Exactly the claims the database's row-level security reads.
  const token = await signJwt({ role: 'authenticated', wallet, exp }, env.SUPABASE_JWT_SECRET);
  return {
    token,
    wallet,
    expiresAt: new Date(exp * 1000).toISOString(),
    nonce: String(claims.nonce),
  };
}

export async function createRelaySession(env: Env, wallet: string): Promise<Session> {
  const exp = nowSecs() + RELAY_SESSION_TTL_SECS;
  const token = await signJwt({ scope: 'relay', wallet, exp }, sessionSecret(env));
  return { token, wallet, expiresAt: new Date(exp * 1000).toISOString() };
}

/** The wallet a bearer token speaks for, or `null`. Accepts relay and wallet sessions. */
export async function walletFromAuthorization(
  env: Env,
  authorization: string | undefined,
): Promise<string | null> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
  if (!token) return null;
  if (env.SESSION_JWT_SECRET) {
    const claims = await verifyJwt(token, env.SESSION_JWT_SECRET);
    if (claims?.scope === 'relay' && typeof claims.wallet === 'string') return claims.wallet;
  }
  if (env.SUPABASE_JWT_SECRET) {
    const claims = await verifyJwt(token, env.SUPABASE_JWT_SECRET);
    if (claims?.role === 'authenticated' && typeof claims.wallet === 'string') return claims.wallet;
  }
  return null;
}

export async function requireWallet(env: Env, authorization: string | undefined): Promise<string> {
  const wallet = await walletFromAuthorization(env, authorization);
  if (!wallet) throw unauthorized();
  return wallet;
}
