/**
 * What collectors hand to the policy. A signal is an observation with no
 * score attached: only `policy.ts` turns signals into points, so the same
 * observations always produce the same tier and window.
 */

export const COLLECTORS = [
  'onchain_reputation',
  'helius',
  'blocklist',
  'chainabuse',
  'web_reports',
  'sns',
  'context',
  'baseline',
] as const;
export type CollectorName = (typeof COLLECTORS)[number];

export interface Signal {
  source: CollectorName;
  /** Rule id within the source, e.g. `sweep_pattern`. */
  signal: string;
  /** One plain-language sentence; becomes `EvidenceItem.detail`. */
  detail: string;
  /** A count, for rules that score per unit (flags, reports). Defaults to 1. */
  value?: number;
  url?: string;
  quote?: string;
  matched?: string;
  date?: string;
}

/** `source.signal`, the key of a rule in the policy table. */
export const ruleId = (signal: Pick<Signal, 'source' | 'signal'>) =>
  `${signal.source}.${signal.signal}`;
