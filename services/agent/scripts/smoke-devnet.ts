/**
 * End-to-end check against the deployed program. It drives the real HTTP
 * API (in this process, so it needs no Worker) and real transactions:
 *
 *   1. assess a payment whose note describes a scam;
 *   2. open a SOL hold that under-reports its tier, and watch the oracle
 *      correct it through POST /v1/holds/:pda/reassess;
 *   3. sign in with the wallet and add time through POST /v1/voice/extend;
 *   4. open a second, short hold and let POST /v1/crank release and close it;
 *   5. undo the first hold, write a Dojo memo, and return the leftover SOL.
 *
 * Needs ORACLE_KEYPAIR, CRANK_KEYPAIR, CRANK_SECRET, DOJO_SECRET,
 * SESSION_JWT_SECRET and SUPABASE_JWT_SECRET in `.dev.vars`, and a funded
 * keypair file to pay for a throwaway sender:
 *
 *   npm run smoke:devnet --workspace services/agent -- <funder-keypair.json>
 *
 * It moves at most 0.05 SOL out of the funder and sends back what is left.
 */
import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  STATUS_NAMES,
  encodeBase58,
  fetchHold,
  fromHex,
  holdPda,
  instructions,
  newNonce,
  tierName,
  type AssessResponse,
  type ReassessResponse,
} from '@holdback/sdk';

import { createApp } from '../src/app';
import { utf8 } from '../src/lib/encoding';
import { sendAndConfirm } from '../src/lib/solana';
import { createServices } from '../src/services';
import { loadEnv, requireVar } from './env';

const FUNDING_LAMPORTS = 50_000_000;
const HOLD_LAMPORTS = 1_000_000n;
const SHORT_WINDOW_SECS = 5;
/** Network fee for a transaction with one signature. */
const BASE_FEE_LAMPORTS = 5_000;
const SCAM_NOTE =
  'A police officer on a video call says I will be arrested unless I pay now. He told me not to tell anyone.';

const env = loadEnv();
for (const name of [
  'ORACLE_KEYPAIR',
  'CRANK_KEYPAIR',
  'CRANK_SECRET',
  'DOJO_SECRET',
  'SESSION_JWT_SECRET',
  'SUPABASE_JWT_SECRET',
] as const) {
  requireVar(env, name);
}
// Evidence stays in this process, so every step reads what the last one wrote.
const localEnv = { ...env, SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined };
const app = createApp();
const services = createServices(localEnv);
const { cluster, programId } = services;

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await app.request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    localEnv,
  );
  const payload = (await response.json()) as T & { error?: { code: string; message: string } };
  if (!response.ok) {
    throw new Error(
      `${method} ${path}: ${response.status} ${payload.error?.code} ${payload.error?.message}`,
    );
  }
  return payload;
}

async function openSolHold(
  sender: Keypair,
  recipient: PublicKey,
  windowSecs: number,
  tier: number,
  evidenceHash: string,
): Promise<{ hold: PublicKey; signature: string }> {
  const nonce = newNonce();
  const signature = await sendAndConfirm(cluster, sender, [
    instructions.createHoldSol({
      sender: sender.publicKey,
      recipient,
      nonce,
      amount: HOLD_LAMPORTS,
      windowSecs,
      tier,
      evidenceHash: fromHex(evidenceHash),
      programId,
    }),
  ]);
  return { hold: holdPda(sender.publicKey, nonce, programId), signature };
}

async function describe(hold: PublicKey): Promise<string> {
  const account = await fetchHold(cluster, hold, { programId });
  if (!account) return 'closed';
  const window = account.releaseAt - account.createdAt;
  return `${STATUS_NAMES[account.status]} tier ${tierName(account.tier)} window ${window}s`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const funderPath = process.argv[2];
  if (!funderPath) throw new Error('Pass the path of a funded keypair file');
  const funder = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(funderPath, 'utf8'))),
  );
  const sender = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const wallet = sender.publicKey.toBase58();
  console.log(`program    ${programId.toBase58()}`);
  console.log(`sender     ${wallet} (throwaway)`);
  console.log(`recipient  ${recipient.toBase58()} (throwaway)`);

  const funding = await sendAndConfirm(cluster, funder, [
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: sender.publicKey,
      lamports: FUNDING_LAMPORTS,
    }),
  ]);
  console.log(`fund sender                 ${funding}`);

  const subject = { sender: wallet, recipient: recipient.toBase58(), mint: null, lang: 'en' };
  const risky = await api<AssessResponse>('POST', '/v1/assess', {
    ...subject,
    amount: HOLD_LAMPORTS.toString(),
    context: SCAM_NOTE,
  });
  console.log(
    `assess (scam note)          ${risky.tier} ${risky.windowSecs}s score ${risky.score}`,
  );
  console.log(`  evidence hash             ${risky.evidenceHash}`);
  console.log(`  unavailable               ${risky.unavailable.join(', ') || 'none'}`);
  console.log(`  spoken                    ${risky.spoken.text}`);

  // A client that ignores the assessment: default tier and window, real evidence hash.
  const first = await openSolHold(sender, recipient, 1_800, 1, risky.evidenceHash);
  console.log(`create hold A               ${first.signature}`);
  console.log(
    `  hold A                    ${first.hold.toBase58()} -> ${await describe(first.hold)}`,
  );

  const reassessed = await api<ReassessResponse>(
    'POST',
    `/v1/holds/${first.hold.toBase58()}/reassess`,
  );
  if (!reassessed.extended || !reassessed.signature) throw new Error('the oracle did not extend');
  console.log(`oracle extend_window        ${reassessed.signature}`);
  console.log(`  hold A                    ${await describe(first.hold)}`);

  const challenge = await api<{ message: string; challenge: string }>(
    'POST',
    '/v1/auth/challenge',
    { wallet },
  );
  const signed = ed25519.sign(utf8(challenge.message), sender.secretKey.subarray(0, 32));
  const session = await api<{ token: string }>('POST', '/v1/auth/session', {
    wallet,
    challenge: challenge.challenge,
    signature: encodeBase58(signed),
  });
  const longer = await api<ReassessResponse>(
    'POST',
    '/v1/voice/extend',
    { hold: first.hold.toBase58(), hours: 2 },
    { authorization: `Bearer ${session.token}` },
  );
  console.log(`voice extend (+2 h)         ${longer.signature}`);
  console.log(`  hold A                    ${await describe(first.hold)}`);

  const clean = await api<AssessResponse>('POST', '/v1/assess', {
    ...subject,
    amount: HOLD_LAMPORTS.toString(),
  });
  const second = await openSolHold(
    sender,
    recipient,
    SHORT_WINDOW_SECS,
    clean.tierIndex,
    clean.evidenceHash,
  );
  console.log(`create hold B (${SHORT_WINDOW_SECS}s window)  ${second.signature}`);
  console.log(`  hold B                    ${second.hold.toBase58()}`);
  await sleep((SHORT_WINDOW_SECS + 8) * 1000);

  const crankHeaders = { 'x-crank-secret': requireVar(env, 'CRANK_SECRET') };
  type Crank = {
    released: { hold: string; signature: string }[];
    closed: { hold: string; signature: string }[];
    errors: { hold: string; error: string }[];
  };
  const crank = await api<Crank>('POST', '/v1/crank', {}, crankHeaders);
  const holdB = second.hold.toBase58();
  console.log(
    `crank release hold B        ${crank.released.find((r) => r.hold === holdB)?.signature}`,
  );
  console.log(
    `crank close hold B          ${crank.closed.find((r) => r.hold === holdB)?.signature}`,
  );
  console.log(
    `  crank totals              released ${crank.released.length}, closed ${crank.closed.length}, errors ${crank.errors.length}`,
  );
  for (const failure of crank.errors)
    console.log(`  crank error               ${failure.hold}: ${failure.error}`);
  console.log(`  recipient balance         ${await cluster.getBalance(recipient)} lamports`);

  const holdA = await fetchHold(cluster, first.hold, { programId });
  if (!holdA) throw new Error('hold A disappeared');
  const undo = await sendAndConfirm(cluster, sender, [
    instructions.reclaim({ authority: sender.publicKey, hold: holdA, programId }),
  ]);
  console.log(`sender undo hold A          ${undo}`);
  const cleanup = await api<Crank>('POST', '/v1/crank', {}, crankHeaders);
  console.log(
    `crank close hold A          ${cleanup.closed.find((r) => r.hold === first.hold.toBase58())?.signature}`,
  );

  const memo = await api<{ signature: string }>(
    'POST',
    '/v1/dojo/memo',
    { runId: `smoke-${Date.now()}`, score: 640, historyHash: risky.evidenceHash },
    { authorization: `Bearer ${requireVar(env, 'DOJO_SECRET')}` },
  );
  console.log(`dojo memo                   ${memo.signature}`);

  // Empty the throwaway exactly: one signature costs BASE_FEE and no
  // priority fee is added, so nothing is left behind as dust.
  const left = await cluster.getBalance(sender.publicKey);
  if (left > BASE_FEE_LAMPORTS) {
    const { blockhash } = await cluster.getLatestBlockhash('confirmed');
    const refund = new Transaction({ feePayer: sender.publicKey, recentBlockhash: blockhash }).add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: funder.publicKey,
        lamports: left - BASE_FEE_LAMPORTS,
      }),
    );
    refund.sign(sender);
    const signature = await cluster.sendRawTransaction(refund.serialize());
    console.log(`return ${left - BASE_FEE_LAMPORTS} lamports     ${signature}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
