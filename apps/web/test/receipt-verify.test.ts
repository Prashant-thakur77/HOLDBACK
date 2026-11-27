import { Tier, fromHex, hashEvidence, toHex } from '@holdback/sdk';
import { describe, expect, it } from 'vitest';

import { verifyReceipt } from '@/lib/receipt/verify';

import { evidenceDocument } from './helpers/guardian';

const document = evidenceDocument(
  {
    sender: 'So11111111111111111111111111111111111111112',
    recipient: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    mint: null,
    amount: '250000000',
    lang: 'en',
  },
  Tier.SUSPICIOUS,
);
const onChain = hashEvidence(document);

describe('verifyReceipt', () => {
  it('matches when the document is the one that was hashed on-chain', () => {
    const result = verifyReceipt(document, onChain);
    expect(result.matches).toBe(true);
    expect(result.recomputedHash).toBe(toHex(onChain));
    expect(result.onChainHash).toBe(toHex(onChain));
    expect(result.recomputedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on key order', () => {
    const reordered = Object.fromEntries(Object.entries(document).reverse()) as typeof document;
    expect(verifyReceipt(reordered, onChain).matches).toBe(true);
  });

  it('reports a mismatch when any field of the document was changed', () => {
    const tampered = { ...document, windowSecs: document.windowSecs - 1 };
    const result = verifyReceipt(tampered, onChain);
    expect(result.matches).toBe(false);
    expect(result.onChainHash).toBe(toHex(onChain));
    expect(result.recomputedHash).not.toBe(result.onChainHash);

    const edited = {
      ...document,
      evidence: [{ ...document.evidence[0]!, detail: 'Edited afterwards.' }],
    };
    expect(verifyReceipt(edited, onChain).matches).toBe(false);
  });

  it('reports a mismatch against a different on-chain hash', () => {
    const other = fromHex('00'.repeat(32));
    const result = verifyReceipt(document, other);
    expect(result.matches).toBe(false);
    expect(result.onChainHash).toBe('00'.repeat(32));
    expect(result.recomputedHash).toBe(toHex(onChain));
  });
});
