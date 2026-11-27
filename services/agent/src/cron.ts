/**
 * Scheduled work. One handler covers three jobs:
 *   every minute      release and close holds, send pushes
 *   every ten minutes re-assess pending holds
 *   hourly            refresh the static lists
 *
 * Deployments can register each job as its own Cron Trigger, or register only
 * the every-minute trigger (free plans cap the number of triggers per account)
 * and let the clock decide which extra jobs are due on that tick.
 */
import { PublicKey } from '@solana/web3.js';
import { HoldStatus, Tier } from '@holdback/sdk';

import { runCrank, type CrankSummary } from './chain/crank';
import { reassessHold } from './chain/oracle';
import type { RefreshResult } from './collectors/blocklist-refresh';
import {
  holdsCreatedSince,
  holdsReleasingBetween,
  holdsSettledSince,
  type HoldRow,
} from './db/holds';
import { loadKeypair } from './lib/keys';
import { notifySender } from './push/expo';
import type { PushKind } from './push/messages';
import type { Services } from './services';
import { maybeCallSender } from './voice/session';

export const CRON_EVERY_MINUTE = '* * * * *';
export const CRON_REASSESS = '*/10 * * * *';
export const CRON_HOURLY = '0 * * * *';

/** How far back the minute job looks for transitions it has not announced yet. */
const LOOKBACK_MS = 5 * 60_000;
/** "5 minutes before release". */
const PRE_RELEASE_MS = 5 * 60_000;
const NOTIFIED_TTL_SECS = 4 * 86_400;
const SCAN_LIMIT = 50;
/** Pending holds re-assessed per run, soonest release first. */
export const MAX_REASSESS_PER_RUN = 10;

async function announce(services: Services, kind: PushKind, hold: HoldRow): Promise<boolean> {
  if (!(await services.cache.claimOnce(`push:${kind}:${hold.pda}`, NOTIFIED_TTL_SECS)))
    return false;
  return notifySender(services, kind, hold);
}

/**
 * Sends the pushes that follow from the mirror: hold placed, five minutes
 * before release, released, reclaimed. Each is claimed once per hold, so
 * overlapping runs and isolates do not repeat a notification.
 */
export async function notifyTransitions(services: Services, now = new Date()): Promise<number> {
  const { db } = services;
  if (!db) return 0;
  const since = new Date(now.getTime() - LOOKBACK_MS);
  const [created, releasing, settled] = await Promise.all([
    holdsCreatedSince(db, since, SCAN_LIMIT),
    holdsReleasingBetween(db, now, new Date(now.getTime() + PRE_RELEASE_MS), SCAN_LIMIT),
    holdsSettledSince(db, since, SCAN_LIMIT),
  ]);

  let sent = 0;
  for (const hold of created.filter((row) => row.status === HoldStatus.PENDING)) {
    if (await announce(services, 'hold_placed', hold)) sent++;
    if (hold.tier >= Tier.FLAGGED) {
      const evidence = await services.storage.evidence.get(hold.evidence_hash).catch(() => null);
      await maybeCallSender(services, hold, evidence?.document ?? null);
    }
  }
  for (const hold of releasing) {
    // A window shorter than the reminder lead time gets no reminder.
    const windowMs = Date.parse(hold.release_at) - Date.parse(hold.created_at);
    if (windowMs > PRE_RELEASE_MS && (await announce(services, 'pre_release', hold))) sent++;
  }
  for (const hold of settled) {
    const kind = hold.status === HoldStatus.RECLAIMED ? 'reclaimed' : 'released';
    if (await announce(services, kind, hold)) sent++;
  }
  return sent;
}

/** Re-assesses pending holds; the oracle extends those whose tier rose. */
export async function reassessPending(services: Services, now = new Date()): Promise<number> {
  const { db } = services;
  if (!db || !loadKeypair(services.env, 'ORACLE_KEYPAIR')) return 0;
  const farFuture = new Date(now.getTime() + 10 * 365 * 86_400_000);
  const pending = await holdsReleasingBetween(db, now, farFuture, MAX_REASSESS_PER_RUN);
  let extended = 0;
  for (const hold of pending) {
    try {
      if ((await reassessHold(services, new PublicKey(hold.pda))).extended) extended++;
    } catch {
      // One hold failing must not stop the rest.
    }
  }
  return extended;
}

export interface MinuteResult {
  crank: CrankSummary | null;
  notified: number;
}

export async function runMinute(services: Services, now = new Date()): Promise<MinuteResult> {
  const crank = loadKeypair(services.env, 'CRANK_KEYPAIR')
    ? await runCrank(services, now).catch(() => null)
    : null;
  const notified = await notifyTransitions(services, now).catch(() => 0);
  return { crank, notified };
}

/** Refreshes the lists in whichever store this process uses. */
export function runHourly(services: Services): Promise<RefreshResult[]> {
  return services.storage.blocklists.refresh();
}

/** Dispatches a Cron Trigger by its expression. */
export async function runScheduled(
  services: Services,
  cron: string,
  scheduledTime = Date.now(),
): Promise<void> {
  for (const job of jobsFor(cron, scheduledTime)) {
    if (job === 'hourly') await runHourly(services);
    else if (job === 'reassess') await reassessPending(services);
    else await runMinute(services);
  }
}

export type CronJob = 'minute' | 'reassess' | 'hourly';

/**
 * The jobs one trigger runs. A dedicated trigger runs its own job; the
 * every-minute trigger also runs the ten-minute and hourly jobs when the tick
 * falls on their minute, so one trigger is enough.
 */
export function jobsFor(cron: string, scheduledTime: number): CronJob[] {
  if (cron === CRON_HOURLY) return ['hourly'];
  if (cron === CRON_REASSESS) return ['reassess'];
  const minute = new Date(scheduledTime).getUTCMinutes();
  const jobs: CronJob[] = ['minute'];
  if (minute % 10 === 0) jobs.push('reassess');
  if (minute === 0) jobs.push('hourly');
  return jobs;
}
