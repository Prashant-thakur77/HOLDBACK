import type { HoldRecord } from '@holdback/sdk';

export interface HistoryEntry extends HoldRecord {
  /** Whether the exporting wallet sent or received this hold. */
  direction: 'sent' | 'received';
}

const COLUMNS = [
  'direction',
  'pda',
  'status',
  'tier',
  'amount',
  'mint',
  'sender',
  'recipient',
  'origin',
  'createdAt',
  'releaseAt',
  'evidenceHash',
  'createSignature',
  'settleSignature',
] as const satisfies readonly (keyof HistoryEntry)[];

/**
 * One CSV cell. Quotes when needed, and prefixes a leading `= + - @` with an
 * apostrophe so a spreadsheet opens the value as text and never as a formula.
 */
function cell(value: string | null): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a header row. Amounts stay in base units, as stored on-chain. */
export function toCsv(entries: readonly HistoryEntry[]): string {
  const rows = entries.map((entry) => COLUMNS.map((column) => cell(entry[column])).join(','));
  return [COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

export function toJson(
  entries: readonly HistoryEntry[],
  wallet: string,
  exportedAt: string,
): string {
  return JSON.stringify({ wallet, exportedAt, count: entries.length, holds: entries }, null, 2);
}

/** Sent and received holds as one list, newest first, each tagged with its direction. */
export function mergeHistory(
  sent: readonly HoldRecord[],
  received: readonly HoldRecord[],
): HistoryEntry[] {
  return [
    ...sent.map((record): HistoryEntry => ({ ...record, direction: 'sent' })),
    ...received.map((record): HistoryEntry => ({ ...record, direction: 'received' })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
