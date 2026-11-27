import type { EvidenceDocument, HoldRecord } from '@holdback/sdk';

import { formatClock, remainingSecs } from '@/lib/countdown';
import { topEvidence } from '@/lib/evidence';

/**
 * Answers for the voice agent's client tools. The agent reads these strings
 * as tool results, so they are short, factual English regardless of the
 * conversation language (the agent translates when it speaks).
 */

export function holdStatusForAgent(
  record: HoldRecord,
  symbol: string,
  amount: string,
  nowMs: number,
): string {
  if (record.status === 'RECLAIMED')
    return `The payment of ${amount} ${symbol} was undone. The money is back with the sender.`;
  if (record.status === 'RELEASED')
    return `The payment of ${amount} ${symbol} was released to the recipient. It can no longer be undone.`;
  const remaining = remainingSecs(record.releaseAt, nowMs);
  if (remaining === 0) {
    return `The undo window is over. ${amount} ${symbol} is about to be delivered to the recipient and can no longer be undone.`;
  }
  return (
    `${amount} ${symbol} is on hold for ${record.recipient}. Risk tier: ${record.tier}. ` +
    `Time left to undo: ${formatClock(remaining)} (hours:minutes:seconds).`
  );
}

/**
 * Evidence for one source, or the strongest items when the source is not
 * given or not found. Only what the evidence document says; nothing is added.
 */
export function evidenceForAgent(
  document: EvidenceDocument | null,
  source: string | undefined,
): string {
  if (!document) return 'The evidence for this hold is not available right now.';
  if (document.evidence.length === 0) return 'No warning signs were found for this recipient.';
  const wanted = (source ?? '').trim().toLowerCase();
  const matching = wanted
    ? document.evidence.filter((item) => item.source.toLowerCase().includes(wanted))
    : [];
  const items = matching.length > 0 ? matching : topEvidence(document.evidence, 3);
  return items
    .map((item) => {
      const where = item.url ? ` Source: ${item.url}` : '';
      const quote = item.quote ? ` Quote: "${item.quote}"` : '';
      return `[${item.source}] ${item.detail}${quote}${where}`;
    })
    .join('\n');
}
