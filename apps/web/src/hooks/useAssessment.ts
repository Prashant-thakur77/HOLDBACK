'use client';

import type { AssessResponse, Lang } from '@holdback/sdk';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useEffect, useMemo, useRef, useState } from 'react';

import { createGuardian } from '@/lib/guardian';
import { toTxError, type TxError } from '@/lib/tx';

/** Typing pause before the agent is asked, so each keystroke is not a request. */
const DEBOUNCE_MS = 400;

export interface AssessmentState {
  assessment: AssessResponse | null;
  /**
   * `idle`: the inputs are incomplete (no wallet, invalid address or no
   * amount). `unavailable`: no agent is configured.
   */
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
  error: TxError | null;
}

function isAddress(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The agent's verdict for a payment the user is still composing: tier, undo
 * window, findings, evidence and the spoken explanation. Re-runs, debounced,
 * whenever an input changes; a response for older inputs is discarded.
 *
 * @param recipient base58 address as typed
 * @param amount base units, or `null` while the field is empty
 * @param mint mint address, or `null` for SOL
 * @param context the user's own words about why they are paying
 */
export function useAssessment(
  recipient: string,
  amount: bigint | null,
  mint: string | null,
  context: string,
  lang: Lang,
): AssessmentState {
  const { publicKey } = useWallet();
  const sender = publicKey?.toBase58() ?? null;
  const guardian = useMemo(() => createGuardian(), []);
  const [state, setState] = useState<AssessmentState>({
    assessment: null,
    status: 'idle',
    error: null,
  });
  const latest = useRef(0);

  const to = recipient.trim();
  const why = context.trim();
  const amountText = amount !== null && amount > 0n ? amount.toString() : null;

  useEffect(() => {
    const request = ++latest.current;
    if (!sender || !amountText || !isAddress(to)) {
      setState({ assessment: null, status: 'idle', error: null });
      return;
    }
    if (!guardian) {
      setState({ assessment: null, status: 'unavailable', error: null });
      return;
    }
    // The previous verdict stays visible while the new one loads.
    setState((previous) => ({ ...previous, status: 'loading', error: null }));
    const timer = setTimeout(() => {
      guardian
        .assess({
          sender,
          recipient: to,
          mint,
          amount: amountText,
          context: why || undefined,
          lang,
        })
        .then((assessment) => {
          if (request === latest.current) setState({ assessment, status: 'ready', error: null });
        })
        .catch((failure: unknown) => {
          if (request !== latest.current) return;
          setState({
            assessment: null,
            status: 'error',
            error: toTxError(failure, 'agent_unavailable'),
          });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [guardian, sender, to, amountText, mint, why, lang]);

  return state;
}
