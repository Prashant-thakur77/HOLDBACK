/**
 * Collector 8: the sender's own habits, from their HOLDBACK history. A
 * payment that is far from what they usually do adds a little risk; a
 * recipient they have paid several times without trouble opens the
 * TRUSTED fast path.
 */
import { HoldStatus } from '@holdback/sdk';

import { senderHistory, type PaymentHistory } from '../db/holds';
import { CollectorUnavailable } from '../errors';
import type { Signal } from '../signals';
import type { Collector } from './types';

/** Past payments read per sender. */
export const HISTORY_LIMIT = 200;
/** Past payments in the same token needed before "typical amount" means anything. */
export const MIN_PAYMENTS_FOR_MEDIAN = 5;
export const ABOVE_TYPICAL_FACTOR = 5;
export const FAR_ABOVE_TYPICAL_FACTOR = 20;
/** Past payments needed before time of day means anything. */
export const MIN_PAYMENTS_FOR_HOURS = 20;
/** An hour is unusual when under 2% of past payments fall in it or its neighbours. */
export const UNUSUAL_HOUR_SHARE = 0.02;

export interface Baseline {
  /** Median amount of past payments in the same token, base units. */
  medianAmount: bigint | null;
  paymentsInToken: number;
  /** Past payments per UTC hour. */
  hourHistogram: number[];
  totalPayments: number;
  releasedToRecipient: number;
  reclaimedFromRecipient: number;
  paymentsToRecipient: number;
}

function median(values: bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2n;
}

export function buildBaseline(
  history: PaymentHistory,
  recipient: string,
  mint: string | null,
): Baseline {
  // A payment the sender undid says nothing about what they normally pay.
  const kept = [
    ...history.holds.filter((hold) => hold.status !== HoldStatus.RECLAIMED),
    ...history.instants,
  ];
  const sameToken = kept.filter((payment) => payment.mint === mint);
  const hourHistogram = new Array<number>(24).fill(0);
  for (const payment of kept) hourHistogram[new Date(payment.created_at).getUTCHours()]!++;
  const toRecipient = history.holds.filter((hold) => hold.recipient === recipient);
  return {
    medianAmount: median(sameToken.map((payment) => BigInt(payment.amount))),
    paymentsInToken: sameToken.length,
    hourHistogram,
    totalPayments: kept.length,
    releasedToRecipient: toRecipient.filter((hold) => hold.status === HoldStatus.RELEASED).length,
    reclaimedFromRecipient: toRecipient.filter((hold) => hold.status === HoldStatus.RECLAIMED)
      .length,
    paymentsToRecipient:
      toRecipient.length +
      history.instants.filter((instant) => instant.recipient === recipient).length,
  };
}

/** Pure mapping from a baseline and this payment to signals. */
export function baselineSignals(baseline: Baseline, amount: bigint, now: Date): Signal[] {
  const source = 'baseline' as const;
  const signals: Signal[] = [];

  if (baseline.releasedToRecipient > 0) {
    signals.push({
      source,
      signal: 'released_to_recipient',
      value: baseline.releasedToRecipient,
      detail: `${baseline.releasedToRecipient} earlier payment(s) from this sender to this recipient completed.`,
    });
  }
  if (baseline.reclaimedFromRecipient > 0) {
    signals.push({
      source,
      signal: 'prior_reclaim_from_recipient',
      detail: `The sender undid ${baseline.reclaimedFromRecipient} earlier payment(s) to this recipient.`,
    });
  }
  if (baseline.paymentsToRecipient === 0) {
    signals.push({
      source,
      signal: 'first_payment_to_recipient',
      detail: 'The sender has not paid this recipient through HOLDBACK before.',
    });
  }

  const typical = baseline.medianAmount;
  if (typical !== null && typical > 0n && baseline.paymentsInToken >= MIN_PAYMENTS_FOR_MEDIAN) {
    const times = Number((amount * 10n) / typical) / 10;
    const detail = `The amount is about ${times} times the sender's typical payment in this token.`;
    if (amount >= typical * BigInt(FAR_ABOVE_TYPICAL_FACTOR)) {
      signals.push({ source, signal: 'amount_far_above_typical', detail });
    } else if (amount >= typical * BigInt(ABOVE_TYPICAL_FACTOR)) {
      signals.push({ source, signal: 'amount_above_typical', detail });
    }
  }

  if (baseline.totalPayments >= MIN_PAYMENTS_FOR_HOURS) {
    const hour = now.getUTCHours();
    const nearby =
      baseline.hourHistogram[(hour + 23) % 24]! +
      baseline.hourHistogram[hour]! +
      baseline.hourHistogram[(hour + 1) % 24]!;
    if (nearby / baseline.totalPayments < UNUSUAL_HOUR_SHARE) {
      signals.push({
        source,
        signal: 'unusual_hour',
        detail: 'The sender has almost never paid at this time of day.',
      });
    }
  }
  return signals;
}

export const baselineCollector: Collector = {
  name: 'baseline',
  timeoutMs: 3_000,
  cacheTtlSecs: null,
  async collect({ services, subject, now }) {
    if (!services.db) throw new CollectorUnavailable('Supabase is not configured');
    const history = await senderHistory(services.db, subject.sender, HISTORY_LIMIT);
    const baseline = buildBaseline(history, subject.recipient, subject.mint);
    return baselineSignals(baseline, subject.amount, now);
  },
};
