/**
 * Turns decoded events into the rows the database function
 * `ingest_hold_events` applies. This is the whole mapping between the
 * on-chain event fields and the `holds` / `instant_transfers` columns.
 */
import type { HoldbackEvent } from './events.ts';
import { usdValue, type Stablecoins } from './stablecoins.ts';

/** `Hold.status` values, as stored on-chain and in `holds.status`. */
const STATUS_RELEASED = 1;
const STATUS_RECLAIMED = 2;

/** The all-zero public key, which the program stores as the mint of a SOL hold. */
const NATIVE_SOL_MINT = '11111111111111111111111111111111';

/**
 * One row of the JSON array passed to `ingest_hold_events`. Field names are
 * the SQL function's contract. Amounts are decimal strings (a u64 does not
 * fit a JSON number) and times are unix seconds.
 */
export type IngestEvent =
  | {
      kind: 'hold_created';
      signature: string;
      pda: string;
      sender: string;
      recipient: string;
      /** null = native SOL, matching `holds.mint`. */
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
      status: typeof STATUS_RELEASED | typeof STATUS_RECLAIMED;
      settled_at: number;
    }
  | {
      kind: 'instant_transfer';
      signature: string;
      sender: string;
      recipient: string;
      mint: string | null;
      amount: string;
      created_at: number;
    };

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function mintOrNull(mint: string): string | null {
  return mint === NATIVE_SOL_MINT ? null : mint;
}

function toRecord(
  event: HoldbackEvent,
  signature: string,
  stablecoins: Stablecoins,
): IngestEvent | null {
  switch (event.name) {
    case 'HoldCreated': {
      const { data } = event;
      const mint = mintOrNull(data.mint);
      return {
        kind: 'hold_created',
        signature,
        pda: data.hold,
        sender: data.sender,
        recipient: data.recipient,
        mint,
        amount: data.amount.toString(),
        tier: data.tier,
        origin: data.origin,
        nonce: data.nonce.toString(),
        created_at: Number(data.createdAt),
        release_at: Number(data.releaseAt),
        evidence_hash: toHex(data.evidenceHash),
        amount_usd: usdValue(stablecoins, mint, data.amount),
      };
    }
    case 'WindowExtended':
      return {
        kind: 'window_extended',
        signature,
        pda: event.data.hold,
        release_at: Number(event.data.newReleaseAt),
        tier: event.data.tier,
        evidence_hash: toHex(event.data.evidenceHash),
      };
    case 'HoldReclaimed':
    case 'HoldReleased':
      return {
        kind: 'hold_settled',
        signature,
        pda: event.data.hold,
        status: event.name === 'HoldReclaimed' ? STATUS_RECLAIMED : STATUS_RELEASED,
        settled_at: Number(event.data.timestamp),
      };
    case 'InstantTransfer':
      return {
        kind: 'instant_transfer',
        signature,
        sender: event.data.sender,
        recipient: event.data.recipient,
        mint: mintOrNull(event.data.mint),
        amount: event.data.amount.toString(),
        created_at: Number(event.data.timestamp),
      };
    default:
      return null;
  }
}

/**
 * Maps one transaction's events to rows, in log order.
 *
 * The database records each extension by signature, which is what makes a
 * replayed delivery harmless. Two extensions of one hold inside a single
 * transaction therefore collapse to the later one: it carries the final
 * release time, tier and evidence hash.
 */
export function toIngestEvents(
  signature: string,
  events: readonly HoldbackEvent[],
  stablecoins: Stablecoins,
): IngestEvent[] {
  const records: IngestEvent[] = [];
  for (const event of events) {
    const record = toRecord(event, signature, stablecoins);
    if (!record) continue;
    if (record.kind === 'window_extended') {
      const earlier = records.findIndex(
        (other) => other.kind === 'window_extended' && other.pda === record.pda,
      );
      if (earlier !== -1) records.splice(earlier, 1);
    }
    records.push(record);
  }
  return records;
}
