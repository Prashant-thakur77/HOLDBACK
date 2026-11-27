/**
 * One shape for a hold, whatever its source. The agent's API already speaks
 * `HoldRecord`; this module converts the other two sources into it: the
 * decoded on-chain account and a row of the Supabase `holds` mirror.
 */
import {
  STATUS_NAMES,
  encodeBase58,
  tierName,
  toHex,
  type Hold,
  type HoldRecord,
} from '@holdback/sdk';
import { z } from 'zod';

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();

/**
 * The on-chain account as a `HoldRecord`. Transaction signatures are not part
 * of the account, so they are `null` here and filled in from the mirror.
 */
export function holdToRecord(hold: Hold): HoldRecord {
  return {
    pda: hold.address.toBase58(),
    sender: hold.sender.toBase58(),
    recipient: hold.recipient.toBase58(),
    mint: hold.isSol ? null : hold.mint.toBase58(),
    amount: hold.amount.toString(),
    tier: tierName(hold.tier),
    origin: hold.origin === 1 ? 'DEPOSIT_BOX' : 'WALLET',
    status: STATUS_NAMES[hold.status] ?? 'PENDING',
    createdAt: iso(hold.createdAt),
    releaseAt: iso(hold.releaseAt),
    evidenceHash: toHex(hold.evidenceHash),
    createSignature: null,
    settleSignature: null,
  };
}

/**
 * `numeric` columns arrive as JSON numbers or strings depending on the
 * transport. Either becomes an exact integer string; a number too large to
 * be exact is rejected so the caller refetches instead of showing a wrong
 * amount.
 */
const baseUnits = z.union([
  z.string().regex(/^\d+$/),
  z
    .number()
    .refine((value) => Number.isSafeInteger(value) && value >= 0)
    .transform((value) => value.toString()),
]);

const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)));

const holdRowSchema = z.object({
  pda: z.string().min(32),
  sender: z.string().min(32),
  recipient: z.string().min(32),
  mint: z.string().nullable(),
  amount: baseUnits,
  tier: z.number().int().min(0).max(4),
  origin: z.number().int().min(0).max(1),
  status: z.number().int().min(0).max(2),
  created_at: timestamp,
  release_at: timestamp,
  evidence_hash: z.string(),
  create_signature: z.string().nullable().optional(),
  settle_signature: z.string().nullable().optional(),
});

/** A row of `public.holds` as a `HoldRecord`, or `null` when the row does not fit the schema. */
export function rowToRecord(row: unknown): HoldRecord | null {
  const parsed = holdRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    pda: data.pda,
    sender: data.sender,
    recipient: data.recipient,
    mint: data.mint,
    amount: data.amount,
    tier: tierName(data.tier),
    origin: data.origin === 1 ? 'DEPOSIT_BOX' : 'WALLET',
    status: STATUS_NAMES[data.status] ?? 'PENDING',
    createdAt: new Date(data.created_at).toISOString(),
    releaseAt: new Date(data.release_at).toISOString(),
    evidenceHash: data.evidence_hash,
    createSignature: data.create_signature ?? null,
    settleSignature: data.settle_signature ?? null,
  };
}

/** Inserts or replaces a record by PDA and keeps the list newest first. */
export function upsertRecord(list: HoldRecord[], record: HoldRecord): HoldRecord[] {
  const rest = list.filter((item) => item.pda !== record.pda);
  return [record, ...rest].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export interface HoldPermissions {
  /** Undo: the sender, while the hold is pending and the window is open. */
  reclaim: boolean;
  /** Pay the recipient now: the sender, while the hold is pending. */
  releaseEarly: boolean;
  /** Pay the recipient after the window: anyone. */
  release: boolean;
  /** Close a settled hold and return its rent: anyone. */
  close: boolean;
  /** Trust and flag instructions are signed by the sender about the recipient. */
  manageRecipient: boolean;
}

/**
 * What `wallet` may do with a hold at `now`, mirroring the program's checks
 * so a page can hide actions that would fail. The program remains the judge:
 * these are hints, and the clock they use is the browser's.
 */
export function holdPermissions(
  record: HoldRecord,
  wallet: string | null,
  now: number = Date.now(),
): HoldPermissions {
  const pending = record.status === 'PENDING';
  const windowOpen = now < Date.parse(record.releaseAt);
  const isSender = wallet !== null && wallet === record.sender;
  return {
    reclaim: pending && windowOpen && isSender,
    releaseEarly: pending && isSender,
    release: pending && !windowOpen && wallet !== null,
    close: !pending && wallet !== null,
    manageRecipient: isSender,
  };
}

/** Base58 of a signature, the form the agent and explorers use. */
export function signatureToBase58(signature: Uint8Array): string {
  return encodeBase58(signature);
}
