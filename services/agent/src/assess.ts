/**
 * One assessment, end to end: run the collectors, apply the policy, build
 * and hash the evidence document, store it, and word the explanation.
 */
import {
  LANGS,
  hashEvidence,
  toHex,
  type AssessResponse,
  type EvidenceDocument,
  type Lang,
} from '@holdback/sdk';

import { ALL_COLLECTORS } from './collectors';
import { runCollectors } from './collectors/run';
import { cachedNames } from './collectors/sns';
import type { Collector, CollectorContext, Subject } from './collectors/types';
import { putEvidence } from './db/evidence';
import { withTimeout } from './lib/http';
import { createLlm } from './llm/client';
import { spokenExplanation, templateSpoken } from './llm/spoken';
import { POLICY_VERSION, decide } from './policy';
import type { Services } from './services';
import type { Signal } from './signals';

/** Longest the response waits for the evidence document to be stored. */
const STORE_TIMEOUT_MS = 2_500;

export interface AssessOptions {
  /**
   * Signals carried over from an earlier assessment of the same payment.
   * Used on re-assessment for what cannot be collected again: the cues from
   * the sender's note, whose text was never stored.
   */
  carried?: Signal[];
  collectors?: Collector[];
  now?: Date;
}

/** Evidence items of a stored document that a re-assessment must keep. */
export function carriedSignals(document: EvidenceDocument): Signal[] {
  return document.evidence
    .filter(
      (item) =>
        item.source === 'context' ||
        (item.source === 'blocklist' && item.signal === 'phishing_domain_in_context'),
    )
    .map((item) => ({
      source: item.source as Signal['source'],
      signal: item.signal,
      detail: item.detail,
      url: item.url,
      matched: item.matched,
    }));
}

function buildDocument(
  subject: Subject,
  signals: Signal[],
  unavailable: string[],
  assessedAt: Date,
): { document: EvidenceDocument; requiresConfirmation: boolean; tierIndex: number } {
  const decision = decide(signals);
  return {
    document: {
      policyVersion: POLICY_VERSION,
      assessedAt: assessedAt.toISOString(),
      sender: subject.sender,
      recipient: subject.recipient,
      mint: subject.mint ?? 'SOL',
      amount: subject.amount.toString(),
      score: decision.score,
      tier: decision.tier,
      windowSecs: decision.windowSecs,
      findings: decision.findings,
      evidence: decision.evidence,
      unavailable,
    },
    requiresConfirmation: decision.requiresConfirmation,
    tierIndex: decision.tierIndex,
  };
}

export async function assess(
  services: Services,
  subject: Subject,
  options: AssessOptions = {},
): Promise<AssessResponse> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const llm = createLlm(services.env);

  let names: ReturnType<CollectorContext['names']> | undefined;
  const context: CollectorContext = {
    services,
    subject,
    llm,
    now,
    names: () =>
      (names ??= cachedNames(services.cache, services.env, subject.recipient).catch(() => null)),
  };

  const outcomes = await runCollectors(options.collectors ?? ALL_COLLECTORS, context);
  const missing = outcomes.filter((outcome) => !outcome.available);
  const unavailable = missing.map((outcome) => outcome.name);
  // Reasons name a missing setting or an upstream host and status, never a secret.
  for (const outcome of missing) {
    console.warn(`collector ${outcome.name} unavailable: ${outcome.reason ?? 'unknown'}`);
  }
  const collected = outcomes.flatMap((outcome) => outcome.signals);
  // Carried signals stand in for a source only when it produced none itself.
  const carried = (options.carried ?? []).filter(
    (signal) =>
      !collected.some((own) => own.source === signal.source && own.signal === signal.signal),
  );

  const { document, requiresConfirmation, tierIndex } = buildDocument(
    subject,
    [...collected, ...carried],
    unavailable,
    now,
  );
  const evidenceHash = toHex(hashEvidence(document));

  const text = await spokenExplanation(llm, document, subject.lang);
  const spoken = Object.fromEntries(
    LANGS.map((lang) => [lang, lang === subject.lang ? text : templateSpoken(document, lang)]),
  ) as Record<Lang, string>;

  // The hash is about to go on-chain; the document should be readable by
  // then. A slow database must not hold the answer up for long, so the write
  // continues in the background once the response has waited long enough.
  const stored = putEvidence(services.db, evidenceHash, { document, spoken });
  await withTimeout(stored, STORE_TIMEOUT_MS).catch(() =>
    services.background.waitUntil(stored.catch(() => undefined)),
  );

  return {
    tier: document.tier,
    tierIndex,
    windowSecs: document.windowSecs,
    score: document.score,
    findings: document.findings,
    evidence: document.evidence,
    spoken: { lang: subject.lang, text },
    evidenceHash,
    document,
    unavailable,
    requiresConfirmation,
    latencyMs: Date.now() - started,
  };
}
