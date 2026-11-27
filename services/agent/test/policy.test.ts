import { describe, expect, it } from 'vitest';
import { hashEvidence, toHex, verifyEvidence, type EvidenceDocument } from '@holdback/sdk';

import {
  FLAGGED_SCORE,
  GROUP_CAPS,
  HISTORY_TRUST_WINDOW_SECS,
  POLICY_VERSION,
  RULES,
  SUSPICIOUS_SCORE,
  decide,
} from '../src/policy';
import type { Signal } from '../src/signals';

const signal = (id: string, extra: Partial<Signal> = {}): Signal => {
  const [source, name] = id.split('.') as [Signal['source'], string];
  return { source, signal: name, detail: `fixture ${id}`, ...extra };
};

const noFlags = [
  signal('onchain_reputation.no_onchain_flags'),
  signal('onchain_reputation.no_offchain_flags'),
];

function document(signals: Signal[]): EvidenceDocument {
  const decision = decide(signals);
  return {
    policyVersion: POLICY_VERSION,
    assessedAt: '2026-11-27T00:00:00.000Z',
    sender: 'sender',
    recipient: 'recipient',
    mint: 'SOL',
    amount: '1000',
    score: decision.score,
    tier: decision.tier,
    windowSecs: decision.windowSecs,
    findings: decision.findings,
    evidence: decision.evidence,
    unavailable: [],
  };
}

describe('tiers', () => {
  it('defaults to UNKNOWN with a 30 minute window', () => {
    const decision = decide([]);
    expect(decision).toMatchObject({ tier: 'UNKNOWN', tierIndex: 1, windowSecs: 1800, score: 0 });
    expect(decision.requiresConfirmation).toBe(false);
  });

  it('stays UNKNOWN at 28, just below the SUSPICIOUS boundary', () => {
    const decision = decide([
      signal('helius.sweep_pattern'), // 25
      signal('helius.wallet_established'), // -10
      signal('helius.wallet_new_7d'), // 8
      signal('baseline.unusual_hour'), // 5
    ]);
    expect(decision.score).toBe(28);
    expect(decision.score).toBeLessThan(SUSPICIOUS_SCORE);
    expect(decision.tier).toBe('UNKNOWN');
  });

  it('becomes SUSPICIOUS at exactly 30 with a 6 hour window', () => {
    const decision = decide([signal('sns.lookalike_name')]);
    expect(decision.score).toBe(SUSPICIOUS_SCORE);
    expect(decision).toMatchObject({ tier: 'SUSPICIOUS', tierIndex: 2, windowSecs: 21600 });
  });

  it('is still SUSPICIOUS at 58, the highest score below 60 the weights can produce', () => {
    const decision = decide([
      signal('helius.sweep_pattern'), // 25
      signal('helius.instant_drain'), // 25
      signal('helius.wallet_new_7d'), // 8
      signal('helius.sweep_pattern'), // repeated: a rule counts once
    ]);
    expect(decision.score).toBe(58);
    expect(decision.tier).toBe('SUSPICIOUS');
    expect(decision.windowSecs).toBe(21600);
  });

  it('becomes FLAGGED at exactly 60 with a 24 hour window', () => {
    const decision = decide([
      signal('sns.lookalike_name'), // 30
      signal('context.remote_access'), // 30
    ]);
    expect(decision.score).toBe(FLAGGED_SCORE);
    expect(decision).toMatchObject({ tier: 'FLAGGED', tierIndex: 3, windowSecs: 86400 });
  });

  it('is FLAGGED by any confirmed scam report, whatever the score', () => {
    for (const id of ['chainabuse.confirmed_reports', 'blocklist.scam_list_address']) {
      const decision = decide([
        signal(id),
        signal('helius.wallet_established'),
        signal('onchain_reputation.clean_releases'),
        signal('helius.prior_history_with_sender'),
      ]);
      expect(decision.tier).toBe('FLAGGED');
      expect(decision.windowSecs).toBe(86400);
      expect(decision.findings.find((finding) => finding.id === id)?.level).toBe('critical');
    }
  });

  it('is SANCTIONED on an OFAC hit: 72 hours and a typed confirmation', () => {
    const decision = decide([signal('blocklist.ofac_sanctioned')]);
    expect(decision).toMatchObject({
      tier: 'SANCTIONED',
      tierIndex: 4,
      windowSecs: 259200,
      requiresConfirmation: true,
      score: 100,
    });
  });

  it('keeps SANCTIONED even when the sender trusts the recipient', () => {
    const decision = decide([
      signal('blocklist.ofac_sanctioned'),
      signal('onchain_reputation.trust_account'),
    ]);
    expect(decision.tier).toBe('SANCTIONED');
  });

  it('is TRUSTED with no window when a Trust account exists', () => {
    const decision = decide([signal('onchain_reputation.trust_account'), ...noFlags]);
    expect(decision).toMatchObject({ tier: 'TRUSTED', tierIndex: 0, windowSecs: 0 });
  });
});

describe('history fast path', () => {
  const released = (count: number) => signal('baseline.released_to_recipient', { value: count });

  it('needs three released holds', () => {
    expect(decide([released(2), ...noFlags]).tier).toBe('UNKNOWN');
    const trusted = decide([released(3), ...noFlags]);
    expect(trusted.tier).toBe('TRUSTED');
    // No Trust account, so the shortest real hold instead of the instant path.
    expect(trusted.windowSecs).toBe(HISTORY_TRUST_WINDOW_SECS);
  });

  it('needs flags to be known and zero', () => {
    expect(decide([released(5)]).tier).toBe('UNKNOWN');
    expect(decide([released(5), signal('onchain_reputation.no_onchain_flags')]).tier).toBe(
      'UNKNOWN',
    );
    const flagged = decide([
      released(5),
      signal('onchain_reputation.onchain_flags', { value: 1 }),
      signal('onchain_reputation.no_offchain_flags'),
    ]);
    expect(flagged.tier).toBe('UNKNOWN');
  });

  it('gives way to warning signs', () => {
    const decision = decide([released(10), ...noFlags, signal('sns.lookalike_name')]);
    expect(decision.tier).toBe('SUSPICIOUS');
  });
});

describe('scoring', () => {
  it('scores per unit up to the cap', () => {
    const flags = (count: number) =>
      decide([signal('onchain_reputation.onchain_flags', { value: count })]).score;
    expect(flags(1)).toBe(15);
    expect(flags(2)).toBe(30);
    expect(flags(3)).toBe(45);
    expect(flags(50)).toBe(45);
  });

  it('spreads a per-unit cap across several evidence items', () => {
    const decision = decide([
      signal('web_reports.scam_report', { url: 'https://a.example/1' }),
      signal('web_reports.scam_report', { url: 'https://b.example/2' }),
      signal('web_reports.scam_report', { url: 'https://c.example/3' }),
    ]);
    expect(decision.evidence.map((item) => item.weight)).toEqual([20, 20, 0]);
    expect(decision.score).toBe(40);
    expect(decision.findings[0]).toMatchObject({ points: 40, evidence: [0, 1, 2] });
  });

  it("caps what the sender's note can add", () => {
    const everyCue = Object.keys(RULES)
      .filter((id) => id.startsWith('context.'))
      .map((id) => signal(id));
    const decision = decide(everyCue);
    expect(decision.score).toBe(GROUP_CAPS.context);
    expect(decision.tier).toBe('FLAGGED');
  });

  it('never leaves 0..100', () => {
    expect(decide([signal('helius.wallet_established')]).score).toBe(0);
    expect(
      decide([signal('blocklist.ofac_sanctioned'), signal('blocklist.scam_list_address')]).score,
    ).toBe(100);
  });

  it('ignores signals that are not in the rule table', () => {
    const decision = decide([signal('helius.made_up_rule'), signal('context.tier_override')]);
    expect(decision.evidence).toEqual([]);
    expect(decision.tier).toBe('UNKNOWN');
  });

  it('weights of the evidence add up to the score when it is in range', () => {
    const decision = decide([
      signal('helius.sweep_pattern'),
      signal('context.urgency'),
      signal('helius.wallet_established'),
    ]);
    expect(decision.evidence.reduce((sum, item) => sum + item.weight, 0)).toBe(decision.score);
  });
});

describe('determinism', () => {
  const signals = [
    signal('helius.sweep_pattern'),
    signal('chainabuse.unconfirmed_reports', { value: 2, url: 'https://www.chainabuse.com/x' }),
    signal('context.urgency'),
    signal('web_reports.scam_report', { url: 'https://b.example', quote: 'q', matched: 'm' }),
    signal('web_reports.scam_report', { url: 'https://a.example', quote: 'q', matched: 'm' }),
    ...noFlags,
  ];

  it('gives the same hash for the same evidence', () => {
    expect(toHex(hashEvidence(document(signals)))).toBe(toHex(hashEvidence(document(signals))));
  });

  it('does not depend on the order collectors answered in', () => {
    const reversed = [...signals].reverse();
    expect(document(reversed)).toEqual(document(signals));
    expect(toHex(hashEvidence(document(reversed)))).toBe(toHex(hashEvidence(document(signals))));
  });

  it('changes the hash when the evidence changes', () => {
    const more = [...signals, signal('helius.instant_drain')];
    expect(toHex(hashEvidence(document(more)))).not.toBe(toHex(hashEvidence(document(signals))));
  });

  it('survives a JSON round trip, as when read back from the database', () => {
    const original = document(signals);
    const stored = JSON.parse(JSON.stringify(original)) as EvidenceDocument;
    expect(verifyEvidence(stored, hashEvidence(original))).toBe(true);
  });
});
