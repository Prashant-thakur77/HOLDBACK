/**
 * The oracle: re-assesses pending holds and, when the tier rose, signs
 * `extend_window`. The program enforces what this key may do: it can only
 * move `release_at` later (never past `created_at + max_window_secs`),
 * only raise the tier, and its only writable account is the hold.
 */
import { PublicKey } from '@solana/web3.js';
import {
  HoldStatus,
  NATIVE_SOL_MINT,
  WINDOW_SECS_BY_TIER,
  fromHex,
  instructions,
  tierName,
  toHex,
  type Hold,
  type Lang,
  type ReassessResponse,
  type Tier,
} from '@holdback/sdk';

import { assess, carriedSignals } from '../assess';
import { getEvidence } from '../db/evidence';
import { holdToRow, ingestEvents } from '../db/holds';
import { getProfile } from '../db/profiles';
import { badRequest } from '../errors';
import { requireKeypair } from '../lib/keys';
import { sendAndConfirm } from '../lib/solana';
import { notifySender } from '../push/expo';
import { windowLimits, type Services } from '../services';
import { maybeCallSender } from '../voice/session';
import { requireHold } from './holds';

const iso = (unixSecs: number) => new Date(unixSecs * 1000).toISOString();

function unchanged(hold: Hold): ReassessResponse {
  return {
    extended: false,
    tier: tierName(hold.tier),
    releaseAt: iso(hold.releaseAt),
    evidenceHash: toHex(hold.evidenceHash),
    signature: null,
  };
}

/**
 * The release time for a hold whose tier rose to `tier`: the new tier's
 * window counted from creation, never earlier than the current release and
 * never later than the program's maximum.
 */
export function extendedReleaseAt(
  hold: Pick<Hold, 'createdAt' | 'releaseAt'>,
  tier: Tier,
  maxWindowSecs: number,
): number {
  const wanted = hold.createdAt + Math.min(WINDOW_SECS_BY_TIER[tier], maxWindowSecs);
  return Math.max(hold.releaseAt, wanted);
}

async function senderLang(services: Services, sender: string): Promise<Lang> {
  if (!services.db) return 'en';
  const profile = await getProfile(services.db, sender).catch(() => null);
  return profile?.lang ?? 'en';
}

/** Signs and sends `extend_window`, then reports it to the mirror. Returns the signature. */
async function extend(
  services: Services,
  hold: Hold,
  newReleaseAt: number,
  tier: number,
  evidenceHash: string,
): Promise<string> {
  const oracle = requireKeypair(services.env, 'ORACLE_KEYPAIR');
  const signature = await sendAndConfirm(services.cluster, oracle, [
    instructions.extendWindow({
      riskOracle: oracle.publicKey,
      hold: hold.address,
      newReleaseAt,
      tier,
      evidenceHash: fromHex(evidenceHash),
      programId: services.programId,
    }),
  ]);
  if (services.db) {
    // The webhook reports the same event; whichever arrives second is a no-op.
    await ingestEvents(services.db, [
      {
        kind: 'window_extended',
        signature,
        pda: hold.address.toBase58(),
        release_at: newReleaseAt,
        tier,
        evidence_hash: evidenceHash,
      },
    ]).catch(() => undefined);
  }
  return signature;
}

/** Re-runs the collectors for a pending hold and extends its window if the tier rose. */
export async function reassessHold(services: Services, pda: PublicKey): Promise<ReassessResponse> {
  const hold = await requireHold(services, pda);
  const nowSecs = Math.floor(Date.now() / 1000);
  if (hold.status !== HoldStatus.PENDING || nowSecs >= hold.releaseAt) return unchanged(hold);

  const sender = hold.sender.toBase58();
  const previous = await getEvidence(services.db, toHex(hold.evidenceHash));
  const result = await assess(
    services,
    {
      sender,
      recipient: hold.recipient.toBase58(),
      mint: hold.mint.equals(NATIVE_SOL_MINT) ? null : hold.mint.toBase58(),
      amount: hold.amount,
      lang: await senderLang(services, sender),
    },
    { carried: previous ? carriedSignals(previous.document) : [] },
  );
  if (result.tierIndex <= hold.tier) return unchanged(hold);

  const { maxWindowSecs } = await windowLimits(services);
  const newReleaseAt = extendedReleaseAt(hold, result.tierIndex as Tier, maxWindowSecs);
  const signature = await extend(
    services,
    hold,
    newReleaseAt,
    result.tierIndex,
    result.evidenceHash,
  );

  const row = {
    ...holdToRow(hold),
    tier: result.tierIndex,
    release_at: iso(newReleaseAt),
    evidence_hash: result.evidenceHash,
  };
  services.background.waitUntil(
    Promise.all([
      notifySender(services, 'risk_rose', row),
      maybeCallSender(services, row, result.document),
    ]),
  );
  return {
    extended: true,
    tier: result.tier,
    releaseAt: iso(newReleaseAt),
    evidenceHash: result.evidenceHash,
    signature,
  };
}

/** Hours the sender may add in one request through the voice agent. */
export const MAX_EXTEND_HOURS = 72;

/**
 * Adds `hours` to a pending hold at the sender's request. The tier and the
 * evidence stay as they are; only the release time moves, and only later.
 */
export async function extendByHours(
  services: Services,
  pda: PublicKey,
  hours: number,
): Promise<ReassessResponse> {
  const hold = await requireHold(services, pda);
  const nowSecs = Math.floor(Date.now() / 1000);
  if (hold.status !== HoldStatus.PENDING || nowSecs >= hold.releaseAt) {
    throw badRequest('This hold is no longer pending', 'hold_not_pending');
  }
  const { maxWindowSecs } = await windowLimits(services);
  const latest = hold.createdAt + maxWindowSecs;
  const newReleaseAt = Math.min(hold.releaseAt + hours * 3_600, latest);
  if (newReleaseAt <= hold.releaseAt) {
    throw badRequest('This hold is already at the longest window allowed', 'window_at_maximum');
  }
  const evidenceHash = toHex(hold.evidenceHash);
  const signature = await extend(services, hold, newReleaseAt, hold.tier, evidenceHash);
  return {
    extended: true,
    tier: tierName(hold.tier),
    releaseAt: iso(newReleaseAt),
    evidenceHash,
    signature,
  };
}
