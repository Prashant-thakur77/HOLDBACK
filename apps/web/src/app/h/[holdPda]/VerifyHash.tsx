'use client';

import { BoxStamp } from '@/components/art/Stamps';
import { T } from '@/components/LangProvider';
import { useVerifyReceipt, type VerifyInput } from '@/hooks/useVerifyReceipt';

/**
 * The "verify the hash" action. The browser reads the hash from the chain,
 * fetches the evidence by that hash and recomputes the sha256 itself; this
 * component shows both values and stamps the outcome. A mismatch is shown in
 * the same calm layout as a match, with what it means.
 */
export function VerifyHash(props: VerifyInput) {
  const { status, result, verify } = useVerifyReceipt(props);
  return (
    <div className="verify-box">
      <div className="verify-box__head">
        <div>
          <h3 className="h3">Check it yourself</h3>
          <p className="small quiet">
            Your browser reads the hash from the chain, downloads the evidence by that hash and
            recomputes the sha256. Nothing is taken on trust from this page.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={status === 'verifying'}
          onClick={() => void verify()}
        >
          {status === 'verifying' ? 'Recomputing…' : <T k="action.verify" />}
        </button>
      </div>

      {status === 'unavailable' ? (
        <p className="notice" role="status">
          Nothing to verify right now: the hash or the evidence document is unavailable.
        </p>
      ) : null}

      {result ? (
        <div className="verify-box__result" role="status">
          <BoxStamp
            text={result.matches ? 'Hash matches' : 'Mismatch'}
            ink={result.matches ? 'blue' : 'red'}
            rotate={result.matches ? 4 : -5}
            className="stamp--struck"
          />
          <dl className="kv">
            <div className="kv__row">
              <dt>Recomputed in this browser</dt>
              <dd className="mono">{result.recomputedHash}</dd>
            </div>
            <div className="kv__row">
              <dt>
                {result.hashSource === 'chain'
                  ? 'Read from the chain just now'
                  : 'Recorded hash (the hold account could not be read)'}
              </dt>
              <dd className="mono">{result.onChainHash}</dd>
            </div>
            <div className="kv__row">
              <dt>Evidence document</dt>
              <dd>
                {result.documentSource === 'agent'
                  ? 'Fetched by its hash from the risk agent just now.'
                  : 'The copy delivered with this page (the agent did not answer).'}
              </dd>
            </div>
          </dl>
          <p className="prose">
            {result.matches
              ? 'The window on this hold was set from exactly this evidence, and the evidence has not been changed since.'
              : 'The evidence shown here is not the evidence this hold was created with. Do not rely on it.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
