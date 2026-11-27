'use client';

import { useVerifyReceipt, type VerifyInput } from '@/hooks/useVerifyReceipt';

// Structure only, visual design pending. Logic: `useVerifyReceipt`.
export function VerifyHash(props: VerifyInput) {
  const { status, result, verify } = useVerifyReceipt(props);
  return (
    <div>
      <button type="button" disabled={status === 'verifying'} onClick={() => void verify()}>
        Verify hash
      </button>
      {status === 'unavailable' ? (
        <p role="status">Nothing to verify: the hash or the evidence document is unavailable.</p>
      ) : null}
      {result ? (
        <dl role="status">
          <dt>Result</dt>
          <dd>{result.matches ? 'Match' : 'Mismatch'}</dd>
          <dt>Recomputed in this browser</dt>
          <dd>
            <code>{result.recomputedHash}</code>
          </dd>
          <dt>{result.hashSource === 'chain' ? 'Read from the chain' : 'Recorded hash'}</dt>
          <dd>
            <code>{result.onChainHash}</code>
          </dd>
        </dl>
      ) : null}
    </div>
  );
}
