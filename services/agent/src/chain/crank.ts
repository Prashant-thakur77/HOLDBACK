/**
 * The crank: releases holds whose window is over and closes settled ones.
 * Both instructions are permissionless on-chain, so this key holds no
 * authority at all. It only pays fees (and the rent of a recipient's token
 * account when that does not exist yet).
 */
import { PublicKey } from '@solana/web3.js';
import { HoldStatus, NATIVE_SOL_MINT, fetchHold, instructions, type Hold } from '@holdback/sdk';

import { dueHoldRows, getHoldRow, ingestEvents } from '../db/holds';
import { requireKeypair } from '../lib/keys';
import { sendAndConfirm } from '../lib/solana';
import type { Services } from '../services';
import { holdsWithStatus, mintInfo } from './holds';

/** Holds released, and settled holds closed, per run. Keeps a run inside its time budget. */
export const MAX_RELEASES_PER_RUN = 15;
export const MAX_CLOSES_PER_RUN = 10;

export interface CrankSummary {
  released: { hold: string; signature: string }[];
  closed: { hold: string; signature: string }[];
  errors: { hold: string; error: string }[];
}

/**
 * Holds that are due: from the mirror when it has any, otherwise straight
 * from the chain, so a missing or lagging mirror cannot strand a payment.
 */
async function dueHolds(services: Services, now: Date): Promise<Hold[]> {
  const { db, cluster, programId } = services;
  if (db) {
    try {
      const rows = await dueHoldRows(db, now, MAX_RELEASES_PER_RUN);
      const loaded = await Promise.all(
        rows.map(async (row) => {
          const hold = await fetchHold(cluster, new PublicKey(row.pda), { programId });
          if (hold && hold.status !== HoldStatus.PENDING) {
            // Settled on-chain but pending in the mirror: bring the mirror in line.
            await reportSettled(services, hold).catch(() => undefined);
          }
          // A closed account cannot say how it settled, so its row is left
          // for the webhook; it is simply not due any more.
          return hold?.status === HoldStatus.PENDING ? hold : null;
        }),
      );
      const due = loaded.filter((hold): hold is Hold => hold !== null);
      // Stale rows must not hide real work: with nothing actionable, ask the chain.
      if (due.length > 0) return due;
    } catch {
      // Fall through to the chain.
    }
  }
  const nowSecs = Math.floor(now.getTime() / 1000);
  return (await holdsWithStatus(services, HoldStatus.PENDING))
    .filter((hold) => hold.releaseAt <= nowSecs)
    .sort((a, b) => a.releaseAt - b.releaseAt)
    .slice(0, MAX_RELEASES_PER_RUN);
}

/**
 * Reports a hold that is settled on-chain to the mirror, using the hold
 * account's latest transaction as the settling one. A no-op when the
 * mirror already knows, or does not know the hold at all.
 */
async function reportSettled(services: Services, hold: Hold): Promise<void> {
  if (!services.db || hold.status === HoldStatus.PENDING) return;
  const [latest] = await services.cluster.getSignaturesForAddress(hold.address, { limit: 1 });
  if (!latest) return;
  await ingestEvents(services.db, [
    {
      kind: 'hold_settled',
      signature: latest.signature,
      pda: hold.address.toBase58(),
      status: hold.status === HoldStatus.RECLAIMED ? 2 : 1,
      settled_at: latest.blockTime ?? Math.floor(Date.now() / 1000),
    },
  ]);
}

async function tokenProgramOf(services: Services, hold: Hold): Promise<PublicKey | undefined> {
  return hold.mint.equals(NATIVE_SOL_MINT)
    ? undefined
    : (await mintInfo(services, hold.mint)).tokenProgram;
}

const message = (error: unknown) => (error instanceof Error ? error.message : 'failed');

export async function runCrank(services: Services, now = new Date()): Promise<CrankSummary> {
  const crank = requireKeypair(services.env, 'CRANK_KEYPAIR');
  const { db, cluster, programId } = services;
  const summary: CrankSummary = { released: [], closed: [], errors: [] };

  for (const hold of await dueHolds(services, now)) {
    const pda = hold.address.toBase58();
    try {
      const signature = await sendAndConfirm(
        cluster,
        crank,
        [
          instructions.release({
            caller: crank.publicKey,
            hold,
            tokenProgram: await tokenProgramOf(services, hold),
            programId,
          }),
        ],
        { computeUnits: 200_000 },
      );
      summary.released.push({ hold: pda, signature });
      if (db) {
        await ingestEvents(db, [
          {
            kind: 'hold_settled',
            signature,
            pda,
            status: HoldStatus.RELEASED,
            settled_at: Math.floor(Date.now() / 1000),
          },
        ]).catch(() => undefined);
      }
    } catch (error) {
      summary.errors.push({ hold: pda, error: message(error) });
    }
  }

  const settled = [
    ...(await holdsWithStatus(services, HoldStatus.RELEASED).catch(() => [])),
    ...(await holdsWithStatus(services, HoldStatus.RECLAIMED).catch(() => [])),
  ];
  for (const hold of settled.slice(0, MAX_CLOSES_PER_RUN)) {
    const pda = hold.address.toBase58();
    try {
      // Close only what the mirror has recorded as settled, so the receipt
      // outlives the account. With no mirror there is nothing to wait for.
      if (db) {
        const row = await getHoldRow(db, pda);
        if (!row || row.status === HoldStatus.PENDING) {
          await reportSettled(services, hold);
          continue;
        }
      }
      const signature = await sendAndConfirm(cluster, crank, [
        instructions.closeHold({ caller: crank.publicKey, hold, programId }),
      ]);
      summary.closed.push({ hold: pda, signature });
    } catch (error) {
      summary.errors.push({ hold: pda, error: message(error) });
    }
  }
  return summary;
}
