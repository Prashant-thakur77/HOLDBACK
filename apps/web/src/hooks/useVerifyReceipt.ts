'use client';

import { useCallback, useState } from 'react';

import type { VerifyInput, VerifyResult } from '@/lib/receipt/verify-in-browser';

export type { VerifyInput, VerifyResult };

export interface VerifyState {
  /** `unavailable`: there was no hash or no evidence document to compare. */
  status: 'idle' | 'verifying' | 'done' | 'unavailable';
  result: VerifyResult | null;
  verify: () => Promise<VerifyResult | null>;
}

/**
 * Drives the "verify hash" button. The check itself is `verifyInBrowser`:
 * the browser reads the hash from the chain, fetches the evidence by that
 * hash and recomputes the sha256 locally.
 *
 * `result.hashSource` and `result.documentSource` say when a fallback to the
 * page's own copy was needed (a closed hold has no account; the agent can be
 * offline).
 */
export function useVerifyReceipt(input: VerifyInput): VerifyState {
  const [status, setStatus] = useState<VerifyState['status']>('idle');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const { pda, evidenceHash, document } = input;

  const verify = useCallback(async () => {
    setStatus('verifying');
    // Loaded on demand: the Solana client is large and most visitors only read the receipt.
    const { verifyInBrowser } = await import('@/lib/receipt/verify-in-browser');
    const next = await verifyInBrowser({ pda, evidenceHash, document });
    setResult(next);
    setStatus(next ? 'done' : 'unavailable');
    return next;
  }, [pda, evidenceHash, document]);

  return { status, result, verify };
}
