import type { Lang } from '@holdback/sdk';

import type { LlmClient } from '../llm/client';
import type { Services } from '../services';
import type { CollectorName, Signal } from '../signals';
import type { RecipientNames } from './sns';

/** One payment to assess. */
export interface Subject {
  sender: string;
  recipient: string;
  /** `null` for native SOL. */
  mint: string | null;
  /** Base units. */
  amount: bigint;
  /** The sender's own words. Read by the context collector only; never stored. */
  context?: string;
  lang: Lang;
}

export interface CollectorContext {
  services: Services;
  subject: Subject;
  llm: LlmClient | null;
  now: Date;
  /**
   * The recipient's .sol names, looked up once and shared by the collectors
   * that need them. Resolves to `null` when the lookup fails.
   */
  names: () => Promise<RecipientNames | null>;
}

export interface Collector {
  name: CollectorName;
  /** Budget for one run. A slower answer is reported as unavailable. */
  timeoutMs: number;
  /** How long an answer is reused, or `null` when the collector reads live every time. */
  cacheTtlSecs: number | null;
  /** Returns signals, or throws `CollectorUnavailable` (or anything else) to fail soft. */
  collect(context: CollectorContext): Promise<Signal[]>;
}

export interface CollectorOutcome {
  name: CollectorName;
  available: boolean;
  signals: Signal[];
  /** Why it was unavailable, for logs. Never shown to users. */
  reason?: string;
  ms: number;
}
