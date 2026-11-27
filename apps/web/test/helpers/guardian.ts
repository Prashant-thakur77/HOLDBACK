import {
  TIER_NAMES,
  WINDOW_SECS_BY_TIER,
  hashEvidence,
  toHex,
  type AssessRequest,
  type AssessResponse,
  type EvidenceDocument,
  type Tier,
} from '@holdback/sdk';

/** A complete evidence document for one assessment, as the agent would store it. */
export function evidenceDocument(
  request: AssessRequest,
  tier: Tier,
  windowSecs: number = WINDOW_SECS_BY_TIER[tier],
): EvidenceDocument {
  return {
    policyVersion: 'test-1',
    assessedAt: '2026-11-27T12:00:00.000Z',
    sender: request.sender,
    recipient: request.recipient,
    mint: request.mint ?? 'SOL',
    amount: request.amount,
    score: tier * 25,
    tier: TIER_NAMES[tier],
    windowSecs,
    findings: [
      { id: 'f1', title: 'Test finding', points: tier * 25, level: 'info', evidence: [0] },
    ],
    evidence: [
      { source: 'blocklist', signal: 'listed', weight: tier * 25, detail: 'Fixture evidence.' },
    ],
    unavailable: [],
  };
}

/** What `/v1/assess` returns for a request the test agent rates as `tier`. */
export function assessment(
  request: AssessRequest,
  tier: Tier,
  windowSecs: number = WINDOW_SECS_BY_TIER[tier],
): AssessResponse {
  const document = evidenceDocument(request, tier, windowSecs);
  return {
    tier: TIER_NAMES[tier],
    tierIndex: tier,
    windowSecs,
    score: document.score,
    findings: document.findings,
    evidence: document.evidence,
    spoken: { lang: request.lang, text: 'Fixture explanation.' },
    evidenceHash: toHex(hashEvidence(document)),
    document,
    unavailable: [],
    requiresConfirmation: tier === 4,
    latencyMs: 1,
  };
}

/** A stand-in for the agent that rates every request as `tier` and records what it was asked. */
export function fakeGuardian(tier: Tier, windowSecs?: number) {
  const requests: AssessRequest[] = [];
  return {
    requests,
    assess: async (request: AssessRequest) => {
      requests.push(request);
      return assessment(request, tier, windowSecs);
    },
  };
}
