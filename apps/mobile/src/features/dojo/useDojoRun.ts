import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  applyMove,
  attachMemo,
  startRun,
  type AddressCheck,
  type DojoState,
  type Move,
} from '@holdback/dojo';
import { useCallback, useEffect, useRef, useState } from 'react';

import { hasAgent } from '@/config';
import { guardian } from '@/data/guardian';
import { USDC_MINT } from '@/data/tokens';
import { useLang } from '@/state/settings';
import { useWallet } from '@/wallet/WalletContext';

const BEST_KEY = 'holdback.dojo.best';
/** Practice amounts are whole USDC; the agent takes base units of a 6-decimal token. */
const PRACTICE_DECIMALS = 6;

/** A random hex string from the platform's secure generator. */
function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface DojoRun {
  state: DojoState | null;
  best: number | null;
  /** True while the address check is asking the risk agent. */
  checking: boolean;
  /** Why the last move was refused by the engine, if it was. */
  error: string | null;
  start(): void;
  play(move: Move): Promise<void>;
  quit(): void;
}

/**
 * One Scam Dojo run, played entirely on the phone with the same engine the
 * hosted game uses. The seed never leaves the device. The only network call
 * is `check_address`, which asks the real risk agent about the scenario's
 * address; when the agent cannot be reached the engine makes that check free.
 */
export function useDojoRun(): DojoRun {
  const lang = useLang();
  const { address } = useWallet();
  const seed = useRef('');
  const [state, setState] = useState<DojoState | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(BEST_KEY).then((stored) => {
      const value = Number(stored);
      if (stored !== null && Number.isFinite(value)) setBest(value);
    });
  }, []);

  const start = useCallback(() => {
    seed.current = randomHex(32);
    setError(null);
    setState(
      startRun({
        runId: `local-${randomHex(8)}`,
        seed: seed.current,
        player: address?.toBase58() ?? 'anonymous',
      }),
    );
  }, [address]);

  const checkAddress = useCallback(
    async (current: DojoState): Promise<AddressCheck> => {
      const ask = current.scenario?.ask;
      if (!hasAgent || !address || !ask) return { available: false };
      try {
        const verdict = await guardian.assess({
          sender: address.toBase58(),
          recipient: ask.to,
          mint: USDC_MINT,
          amount: (BigInt(Math.round(ask.amount)) * 10n ** BigInt(PRACTICE_DECIMALS)).toString(),
          lang,
        });
        return {
          available: true,
          tier: verdict.tier,
          score: verdict.score,
          window_secs: verdict.windowSecs,
          summary: verdict.spoken.text,
        };
      } catch {
        return { available: false };
      }
    },
    [address, lang],
  );

  const play = useCallback(
    async (move: Move) => {
      if (!state || checking) return;
      let check: AddressCheck = { available: false };
      if (move === 'check_address') {
        setChecking(true);
        check = await checkAddress(state);
        setChecking(false);
      }
      const outcome = applyMove(state, seed.current, move, state.turn, check);
      if (!outcome.applied) {
        setError(outcome.error);
        return;
      }
      setError(null);
      let next = outcome.state;
      if (next.done && next.result) {
        // Offline practice: nothing is written on-chain, and the result says so.
        next = attachMemo(next, null);
        const score = next.result?.score ?? 0;
        if (best === null || score > best) {
          setBest(score);
          void AsyncStorage.setItem(BEST_KEY, String(score));
        }
      }
      setState(next);
    },
    [state, checking, checkAddress, best],
  );

  const quit = useCallback(() => {
    setState(null);
    setError(null);
  }, []);

  return { state, best, checking, error, start, play, quit };
}
