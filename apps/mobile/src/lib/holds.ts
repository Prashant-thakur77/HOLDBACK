import {
  HoldOrigin,
  NATIVE_SOL_MINT,
  STATUS_NAMES,
  TIER_NAMES,
  toHex,
  type Hold,
  type HoldRecord,
} from '@holdback/sdk';

import { toMs } from './countdown';

/** Where a hold stands for the person looking at it. */
export type HoldPhase = 'undoable' | 'releasable' | 'released' | 'reclaimed';

export function holdPhase(
  record: Pick<HoldRecord, 'status' | 'releaseAt'>,
  nowMs: number,
): HoldPhase {
  if (record.status === 'RELEASED') return 'released';
  if (record.status === 'RECLAIMED') return 'reclaimed';
  return nowMs < toMs(record.releaseAt) ? 'undoable' : 'releasable';
}

/** An on-chain `Hold` account in the shape the agent returns, so one UI renders both. */
export function recordFromChain(hold: Hold): HoldRecord {
  return {
    pda: hold.address.toBase58(),
    sender: hold.sender.toBase58(),
    recipient: hold.recipient.toBase58(),
    mint: hold.mint.equals(NATIVE_SOL_MINT) ? null : hold.mint.toBase58(),
    amount: hold.amount.toString(),
    tier: TIER_NAMES[hold.tier] ?? 'UNKNOWN',
    origin: hold.origin === HoldOrigin.DEPOSIT_BOX ? 'DEPOSIT_BOX' : 'WALLET',
    status: STATUS_NAMES[hold.status] ?? 'PENDING',
    createdAt: new Date(hold.createdAt * 1000).toISOString(),
    releaseAt: new Date(hold.releaseAt * 1000).toISOString(),
    evidenceHash: toHex(hold.evidenceHash),
    createSignature: null,
    settleSignature: null,
  };
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * A row of the `holds` table (as Supabase Realtime delivers it) as a
 * `HoldRecord`. Returns `null` for anything that is not a complete row, so a
 * malformed event can never put a broken hold on screen.
 */
export function recordFromRow(row: unknown): HoldRecord | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const pda = text(r.pda);
  const sender = text(r.sender);
  const recipient = text(r.recipient);
  const createdAt = text(r.created_at);
  const releaseAt = text(r.release_at);
  const tier = TIER_NAMES[Number(r.tier)];
  const status = STATUS_NAMES[Number(r.status)];
  if (!pda || !sender || !recipient || !createdAt || !releaseAt || !tier || !status) return null;
  if (r.amount === null || r.amount === undefined || !/^\d+$/.test(String(r.amount))) return null;
  return {
    pda,
    sender,
    recipient,
    mint: text(r.mint),
    amount: String(r.amount),
    tier,
    origin: Number(r.origin) === HoldOrigin.DEPOSIT_BOX ? 'DEPOSIT_BOX' : 'WALLET',
    status,
    createdAt,
    releaseAt,
    evidenceHash: text(r.evidence_hash) ?? '',
    createSignature: text(r.create_signature),
    settleSignature: text(r.settle_signature),
  };
}

/** Replaces the record with the same address or adds it, keeping newest first. */
export function upsertRecord(list: readonly HoldRecord[], incoming: HoldRecord): HoldRecord[] {
  const rest = list.filter((record) => record.pda !== incoming.pda);
  return [incoming, ...rest].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

/** Pending holds first, soonest release on top; settled ones after, newest first. */
export function sortForDisplay(list: readonly HoldRecord[]): HoldRecord[] {
  return [...list].sort((a, b) => {
    const aPending = a.status === 'PENDING';
    const bPending = b.status === 'PENDING';
    if (aPending !== bPending) return aPending ? -1 : 1;
    return aPending ? toMs(a.releaseAt) - toMs(b.releaseAt) : toMs(b.createdAt) - toMs(a.createdAt);
  });
}
