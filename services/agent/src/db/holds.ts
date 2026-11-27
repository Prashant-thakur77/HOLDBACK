/**
 * The off-chain mirror of holds. The chain stays the source of truth: the
 * mirror is what lists, Realtime and the crank's "what is due" query read.
 * It is read directly and written only through `ingest_hold_events`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  HoldOrigin,
  NATIVE_SOL_MINT,
  STATUS_NAMES,
  tierName,
  toHex,
  type Hold,
  type HoldRecord,
} from '@holdback/sdk';

/** `amount` is cast to text: a numeric(20,0) does not fit a JSON number. */
const COLUMNS =
  'pda, sender, recipient, mint, amount::text, tier, origin, status, created_at, release_at, settled_at, evidence_hash, create_signature, settle_signature, amount_usd';

export interface HoldRow {
  pda: string;
  sender: string;
  recipient: string;
  mint: string | null;
  amount: string;
  tier: number;
  origin: number;
  status: number;
  created_at: string;
  release_at: string;
  settled_at: string | null;
  evidence_hash: string;
  create_signature: string | null;
  settle_signature: string | null;
  amount_usd: number | null;
}

export function rowToRecord(row: HoldRow): HoldRecord {
  return {
    pda: row.pda,
    sender: row.sender,
    recipient: row.recipient,
    mint: row.mint,
    amount: row.amount,
    tier: tierName(row.tier),
    origin: row.origin === HoldOrigin.DEPOSIT_BOX ? 'DEPOSIT_BOX' : 'WALLET',
    status: STATUS_NAMES[row.status] ?? 'PENDING',
    createdAt: new Date(row.created_at).toISOString(),
    releaseAt: new Date(row.release_at).toISOString(),
    evidenceHash: row.evidence_hash,
    createSignature: row.create_signature,
    settleSignature: row.settle_signature,
  };
}

/** A decoded on-chain hold in the mirror's row shape. */
export function holdToRow(hold: Hold): HoldRow {
  return {
    pda: hold.address.toBase58(),
    sender: hold.sender.toBase58(),
    recipient: hold.recipient.toBase58(),
    mint: hold.mint.equals(NATIVE_SOL_MINT) ? null : hold.mint.toBase58(),
    amount: hold.amount.toString(),
    tier: hold.tier,
    origin: hold.origin,
    status: hold.status,
    created_at: new Date(hold.createdAt * 1000).toISOString(),
    release_at: new Date(hold.releaseAt * 1000).toISOString(),
    settled_at: null,
    evidence_hash: toHex(hold.evidenceHash),
    create_signature: null,
    settle_signature: null,
    amount_usd: null,
  };
}

async function rows(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<HoldRow[]> {
  const { data, error } = await query;
  if (error) throw new Error('hold query failed');
  return (data ?? []) as HoldRow[];
}

export async function getHoldRow(db: SupabaseClient, pda: string): Promise<HoldRow | null> {
  return (await rows(db.from('holds').select(COLUMNS).eq('pda', pda).limit(1)))[0] ?? null;
}

/** True when some mirrored hold carries this evidence hash. */
export async function evidenceInUse(db: SupabaseClient, evidenceHash: string): Promise<boolean> {
  const { data, error } = await db
    .from('holds')
    .select('pda')
    .eq('evidence_hash', evidenceHash)
    .limit(1);
  if (error) throw new Error('hold query failed');
  return (data ?? []).length > 0;
}

export function listHoldRows(
  db: SupabaseClient,
  wallet: string,
  role: 'sender' | 'recipient',
): Promise<HoldRow[]> {
  return rows(
    db
      .from('holds')
      .select(COLUMNS)
      .eq(role, wallet)
      .order('created_at', { ascending: false })
      .limit(100),
  );
}

/** Pending holds whose window is over. */
export function dueHoldRows(db: SupabaseClient, now: Date, limit: number): Promise<HoldRow[]> {
  return rows(
    db
      .from('holds')
      .select(COLUMNS)
      .eq('status', 0)
      .lte('release_at', now.toISOString())
      .order('release_at', { ascending: true })
      .limit(limit),
  );
}

/** Pending holds releasing inside `(from, to]`. */
export function holdsReleasingBetween(
  db: SupabaseClient,
  from: Date,
  to: Date,
  limit: number,
): Promise<HoldRow[]> {
  return rows(
    db
      .from('holds')
      .select(COLUMNS)
      .eq('status', 0)
      .gt('release_at', from.toISOString())
      .lte('release_at', to.toISOString())
      .order('release_at', { ascending: true })
      .limit(limit),
  );
}

/** Holds created since `since`, newest first. */
export function holdsCreatedSince(
  db: SupabaseClient,
  since: Date,
  limit: number,
): Promise<HoldRow[]> {
  return rows(
    db
      .from('holds')
      .select(COLUMNS)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

/** Holds settled (released or reclaimed) since `since`. */
export function holdsSettledSince(
  db: SupabaseClient,
  since: Date,
  limit: number,
): Promise<HoldRow[]> {
  return rows(
    db
      .from('holds')
      .select(COLUMNS)
      .in('status', [1, 2])
      .gte('updated_at', since.toISOString())
      .order('updated_at', { ascending: false })
      .limit(limit),
  );
}

/**
 * One row of the array `ingest_hold_events` applies. This is the same
 * record shape the chain webhook sends: the database function is the only
 * writer of `holds`, `instant_transfers` and the daily counters, and it is
 * idempotent, so the webhook and this service can both report an event.
 * Amounts are decimal strings and times are unix seconds.
 */
export type IngestEvent =
  | {
      kind: 'hold_created';
      signature: string;
      pda: string;
      sender: string;
      recipient: string;
      mint: string | null;
      amount: string;
      tier: number;
      origin: number;
      nonce: string;
      created_at: number;
      release_at: number;
      evidence_hash: string;
      amount_usd: string | null;
    }
  | {
      kind: 'window_extended';
      signature: string;
      pda: string;
      release_at: number;
      tier: number;
      evidence_hash: string;
    }
  | {
      kind: 'hold_settled';
      signature: string;
      pda: string;
      status: 1 | 2;
      settled_at: number;
    };

export type IngestOutcome = 'applied' | 'duplicate' | 'unknown_hold';

/** Applies events to the mirror and returns the outcome of each, in order. */
export async function ingestEvents(
  db: SupabaseClient,
  events: IngestEvent[],
): Promise<IngestOutcome[]> {
  const { data, error } = await db.rpc('ingest_hold_events', { p_events: events });
  if (error) throw new Error('could not mirror the hold');
  return ((data ?? []) as { outcome: IngestOutcome }[]).map((result) => result.outcome);
}

/** The `hold_created` event for a hold read from the chain. */
export function createdEvent(hold: Hold, signature: string, amountUsd: string | null): IngestEvent {
  const row = holdToRow(hold);
  return {
    kind: 'hold_created',
    signature,
    pda: row.pda,
    sender: row.sender,
    recipient: row.recipient,
    mint: row.mint,
    amount: row.amount,
    tier: hold.tier,
    origin: hold.origin,
    nonce: hold.nonce.toString(),
    created_at: hold.createdAt,
    release_at: hold.releaseAt,
    evidence_hash: row.evidence_hash,
    amount_usd: amountUsd,
  };
}

export interface PaymentHistory {
  holds: {
    recipient: string;
    mint: string | null;
    amount: string;
    status: number;
    created_at: string;
  }[];
  instants: { recipient: string; mint: string | null; amount: string; created_at: string }[];
}

/** The sender's most recent payments through HOLDBACK, for the baseline. */
export async function senderHistory(
  db: SupabaseClient,
  sender: string,
  limit: number,
): Promise<PaymentHistory> {
  const [holds, instants] = await Promise.all([
    db
      .from('holds')
      .select('recipient, mint, amount::text, status, created_at')
      .eq('sender', sender)
      .order('created_at', { ascending: false })
      .limit(limit),
    db
      .from('instant_transfers')
      .select('recipient, mint, amount::text, created_at')
      .eq('sender', sender)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);
  if (holds.error || instants.error) throw new Error('history query failed');
  return {
    holds: (holds.data ?? []) as PaymentHistory['holds'],
    instants: (instants.data ?? []) as PaymentHistory['instants'],
  };
}
