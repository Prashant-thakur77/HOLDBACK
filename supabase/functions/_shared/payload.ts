/**
 * Normalises a Helius webhook delivery.
 *
 * Helius posts a JSON array of transactions in one of two shapes:
 *
 * - raw (`raw`, `rawDevnet`): the `getTransaction` result, with
 *   `transaction.signatures`, `meta.err` and `meta.logMessages`. Failed
 *   transactions are delivered too.
 * - enhanced (`enhanced`, `enhancedDevnet`): Helius' parsed form, with a
 *   top-level `signature` and `transactionError` but no log messages.
 *
 * Events live in the logs, so an enhanced delivery only tells us which
 * signatures to look up.
 */

export interface WebhookTransaction {
  signature: string;
  slot: number;
  /** A failed transaction changed nothing on-chain; whatever it logged is void. */
  failed: boolean;
  /** Log messages, or null when the payload shape does not include them. */
  logs: string[] | null;
}

/** The request body is not a Helius delivery we understand. */
export class PayloadError extends Error {}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slotOf(entry: Json): number {
  return typeof entry.slot === 'number' ? entry.slot : 0;
}

function fromRaw(entry: Json): WebhookTransaction | null {
  const { transaction, meta } = entry;
  if (!isObject(transaction) || !isObject(meta)) return null;
  const signatures = transaction.signatures;
  const signature = Array.isArray(signatures) ? signatures[0] : undefined;
  if (typeof signature !== 'string') return null;
  const logs = meta.logMessages;
  return {
    signature,
    slot: slotOf(entry),
    failed: meta.err !== null && meta.err !== undefined,
    logs: Array.isArray(logs) ? logs.filter((line) => typeof line === 'string') : [],
  };
}

function fromEnhanced(entry: Json): WebhookTransaction | null {
  if (typeof entry.signature !== 'string') return null;
  const error = entry.transactionError;
  return {
    signature: entry.signature,
    slot: slotOf(entry),
    failed: error !== null && error !== undefined,
    logs: null,
  };
}

/**
 * Returns the delivery's transactions, oldest first, so a hold's creation is
 * applied before a settlement that arrives in the same batch.
 */
export function parseWebhookBody(body: unknown): WebhookTransaction[] {
  const entries = Array.isArray(body) ? body : [body];
  const transactions = entries.map((entry, index) => {
    const parsed = isObject(entry) ? (fromRaw(entry) ?? fromEnhanced(entry)) : null;
    if (!parsed) throw new PayloadError(`Entry ${index} is not a raw or enhanced transaction`);
    return parsed;
  });
  // Array.prototype.sort is stable: transactions of one slot keep delivery order.
  return transactions.sort((a, b) => a.slot - b.slot);
}
