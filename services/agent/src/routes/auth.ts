/** Sign-in for wallets that can sign, and proof-by-transfer for wallets that cannot. */
import { sha256 } from '@noble/hashes/sha256';
import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { toHex, type RelayAuthStart, type RelaySession } from '@holdback/sdk';

import {
  CHALLENGE_TTL_SECS,
  createChallenge,
  createRelaySession,
  createWalletSession,
  requireWallet,
} from '../auth';
import { verifyProofTransfer } from '../chain/proof';
import {
  boxAddresses,
  ensureDepositBox,
  relayOpen,
  relayReclaim,
  relayWithdraw,
  tokenBalance,
} from '../chain/relayer';
import { completeChallenge, createChallenge as storeChallenge, getChallenge } from '../db/relay';
import { badRequest, forbidden, notFound, unauthorized, unavailable } from '../errors';
import { randomHex, timingSafeEqual, utf8 } from '../lib/encoding';
import { address, amount, body, lang, type App } from './shared';

/** How long the owner has to make the proving transfer. */
export const RELAY_CHALLENGE_TTL_SECS = 15 * 60;
/** The proving transfer is this many base units: small, and random enough not to be guessed. */
export const PROOF_AMOUNT_MIN = 10_000;
export const PROOF_AMOUNT_MAX = 99_999;

const hashSecret = (secret: string) => toHex(sha256(utf8(secret)));

function randomProofAmount(): number {
  const span = PROOF_AMOUNT_MAX - PROOF_AMOUNT_MIN + 1;
  const [random] = crypto.getRandomValues(new Uint32Array(1));
  return PROOF_AMOUNT_MIN + (random! % span);
}

const signature = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/, 'must be a transaction signature');

export function authRoutes(app: App): void {
  app.post('/v1/auth/challenge', async (c) => {
    const { wallet } = await body(c, z.object({ wallet: address }));
    return c.json(await createChallenge(c.env, wallet));
  });

  app.post('/v1/auth/session', async (c) => {
    const request = await body(
      c,
      z.object({ wallet: address, challenge: z.string().min(1), signature: z.string().min(1) }),
    );
    const { nonce, ...session } = await createWalletSession(
      c.env,
      request.wallet,
      request.challenge,
      request.signature,
    );
    // A signed challenge is good for one session.
    if (!(await c.var.services.cache.claimOnce(`auth:${nonce}`, CHALLENGE_TTL_SECS))) {
      throw unauthorized('This sign-in challenge was already used');
    }
    return c.json(session);
  });

  app.post('/v1/relay/auth/start', async (c) => {
    const request = await body(c, z.object({ owner: address, mint: address }));
    const { db } = c.var.services;
    if (!db) throw unavailable('Relay sign-in needs the database');
    const owner = new PublicKey(request.owner);
    const mint = new PublicKey(request.mint);
    // The relayer pays rent for a new deposit box. It does so only for a
    // wallet that can actually make the proving transfer, which keeps the
    // endpoint from being used to drain the relayer with made-up owners.
    if ((await tokenBalance(c.var.services, owner, mint)) < BigInt(PROOF_AMOUNT_MAX)) {
      throw badRequest(
        'This wallet does not hold enough of this token to prove ownership',
        'insufficient_balance',
      );
    }
    const box = await ensureDepositBox(c.var.services, owner, mint);

    const secret = randomHex(32);
    const challenge = await storeChallenge(db, {
      owner: request.owner,
      mint: request.mint,
      amount: String(randomProofAmount()),
      secret_hash: hashSecret(secret),
      expires_at: new Date(Date.now() + RELAY_CHALLENGE_TTL_SECS * 1000).toISOString(),
    });
    const response: RelayAuthStart = {
      challengeId: challenge.id,
      secret,
      amount: challenge.amount,
      mint: request.mint,
      depositBox: box.depositBox.toBase58(),
      boxTokenAccount: box.boxTokenAccount.toBase58(),
      expiresAt: new Date(challenge.expires_at).toISOString(),
    };
    return c.json(response);
  });

  app.post('/v1/relay/auth/complete', async (c) => {
    const request = await body(
      c,
      z.object({ challengeId: z.uuid(), secret: z.string().min(1).max(200), signature }),
    );
    const services = c.var.services;
    if (!services.db) throw unavailable('Relay sign-in needs the database');

    const challenge = await getChallenge(services.db, request.challengeId);
    if (!challenge) throw notFound('No such challenge');
    if (!timingSafeEqual(hashSecret(request.secret), challenge.secret_hash)) {
      throw forbidden('The challenge secret does not match');
    }
    if (challenge.completed_at)
      throw forbidden('This challenge was already used', 'challenge_used');
    if (Date.parse(challenge.expires_at) < Date.now()) {
      throw forbidden('This challenge has expired', 'challenge_expired');
    }

    const owner = new PublicKey(challenge.owner);
    const box = await boxAddresses(services, owner, new PublicKey(challenge.mint));
    const transaction = await services.cluster.getParsedTransaction(request.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    const failure = verifyProofTransfer(transaction, {
      owner: challenge.owner,
      mint: challenge.mint,
      amount: BigInt(challenge.amount),
      boxTokenAccount: box.boxTokenAccount.toBase58(),
      createdAt: Math.floor(Date.parse(challenge.created_at) / 1000),
      expiresAt: Math.floor(Date.parse(challenge.expires_at) / 1000),
    });
    if (failure)
      throw forbidden(`The transfer does not prove this challenge (${failure})`, failure);

    // One challenge, one transaction, one session.
    if (!(await completeChallenge(services.db, challenge.id, request.signature))) {
      throw forbidden('This challenge or transaction was already used', 'challenge_used');
    }
    const session = await createRelaySession(c.env, challenge.owner);
    const response: RelaySession = {
      token: session.token,
      owner: session.wallet,
      expiresAt: session.expiresAt,
    };
    return c.json(response);
  });

  app.post('/v1/relay/open', async (c) => {
    const owner = await requireWallet(c.env, c.req.header('authorization'));
    const request = await body(
      c,
      z.object({
        recipient: address,
        mint: address,
        amount,
        context: z.string().max(1_000).optional(),
        lang,
        windowSecs: z.number().int().min(0).max(259_200).optional(),
      }),
    );
    return c.json(await relayOpen(c.var.services, owner, request));
  });

  app.post('/v1/relay/reclaim', async (c) => {
    const owner = await requireWallet(c.env, c.req.header('authorization'));
    const { hold } = await body(c, z.object({ hold: address }));
    return c.json({ signature: await relayReclaim(c.var.services, owner, hold) });
  });

  app.post('/v1/relay/withdraw', async (c) => {
    const owner = await requireWallet(c.env, c.req.header('authorization'));
    const request = await body(c, z.object({ mint: address, amount }));
    if (request.amount === '0') throw badRequest('amount must be positive');
    return c.json({
      signature: await relayWithdraw(c.var.services, owner, request.mint, BigInt(request.amount)),
    });
  });
}
