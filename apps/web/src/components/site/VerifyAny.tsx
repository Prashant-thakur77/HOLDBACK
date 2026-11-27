'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { BoxStamp } from '@/components/art/Stamps';
import { playSound } from '@/lib/sound';
import type { VerifyResult } from '@/lib/receipt/verify-in-browser';

/** Base58, 32 to 44 characters: the shape of a Solana address. */
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type State =
  | { kind: 'idle' }
  | { kind: 'working'; address: string }
  | { kind: 'done'; address: string; result: VerifyResult }
  | { kind: 'nothing'; address: string }
  | { kind: 'invalid' };

/**
 * Verify any receipt, here, without opening it. The visitor pastes a hold
 * address (or takes the real example); this browser reads the hash from the
 * hold account on-chain, downloads the evidence by that hash, recomputes the
 * sha256 and stamps the outcome. Nothing from the server is involved, which
 * is the point.
 */
export function VerifyAny({ example }: { example: string }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const run = async (address: string) => {
    if (!ADDRESS.test(address)) {
      setState({ kind: 'invalid' });
      return;
    }
    setState({ kind: 'working', address });
    // Loaded on demand: the Solana client is large and most visitors never press this.
    const { verifyInBrowser } = await import('@/lib/receipt/verify-in-browser');
    let result = await verifyInBrowser({ pda: address, evidenceHash: '', document: null });
    if (!result) {
      // A settled hold is closed on-chain and has no account to read. The risk
      // agent's record of it is then the only hash there is; the result says so.
      const { createGuardian } = await import('@/lib/guardian');
      const recorded = await createGuardian()
        ?.receipt(address)
        .catch(() => null);
      if (recorded) {
        result = await verifyInBrowser({
          pda: address,
          evidenceHash: recorded.hold.evidenceHash,
          document: recorded.document,
        });
      }
    }
    setState(result ? { kind: 'done', address, result } : { kind: 'nothing', address });
    if (result) playSound('stamp');
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run(value.trim());
  };

  return (
    <div className="verify-any">
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="verify-any-address">
            Check any hold: paste its address
          </label>
          <div className="open-receipt__row">
            <input
              id="verify-any-address"
              className="input input--mono"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Hold address"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="verify-any-hint"
              aria-invalid={state.kind === 'invalid' ? true : undefined}
            />
            <button type="submit" className="btn" disabled={state.kind === 'working'}>
              {state.kind === 'working' ? 'Recomputing…' : 'Verify the hash'}
            </button>
          </div>
          <p id="verify-any-hint" className="field__hint">
            No address to hand?{' '}
            <button
              type="button"
              className="link verify-any__example"
              onClick={() => {
                setValue(example);
                void run(example);
              }}
            >
              Use a real hold from devnet
            </button>
            . The hash is recomputed by your browser, not by this site.
          </p>
        </div>
      </form>

      <div className="verify-any__out" role="status">
        {state.kind === 'invalid' ? (
          <p className="notice" data-ink="red">
            That does not look like a Solana address. A hold address is 32 to 44 characters.
          </p>
        ) : state.kind === 'nothing' ? (
          <p className="notice" data-ink="ochre">
            Nothing could be verified for this address: no hold account was readable on-chain, or
            its evidence document is not available right now.{' '}
            <Link href={`/h/${state.address}`} className="link">
              Open its receipt
            </Link>
          </p>
        ) : state.kind === 'done' ? (
          <div className="verify-any__result">
            <BoxStamp
              text={state.result.matches ? 'Hash matches' : 'Mismatch'}
              ink={state.result.matches ? 'blue' : 'red'}
              rotate={state.result.matches ? 3 : -4}
              size={52}
              className="stamp--struck"
            />
            <dl className="kv">
              <div className="kv__row">
                <dt>Recomputed here</dt>
                <dd className="mono">{state.result.recomputedHash}</dd>
              </div>
              <div className="kv__row">
                <dt>
                  {state.result.hashSource === 'chain' ? 'Read from the chain' : 'Recorded hash'}
                </dt>
                <dd className="mono">{state.result.onChainHash}</dd>
              </div>
            </dl>
            <p className="small">
              {state.result.matches
                ? 'The window on this hold was set from exactly this evidence. '
                : 'The evidence on file is not what this hold was created with. '}
              {state.result.hashSource === 'page'
                ? 'This hold has been settled and closed on-chain, so the hash compared here is the one recorded while it was open, not one read from the chain just now. '
                : ''}
              <Link href={`/h/${state.address}`} className="link">
                Open the full receipt
              </Link>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
