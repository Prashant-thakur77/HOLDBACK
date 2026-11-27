'use client';

import { useEffect, useState } from 'react';

import { errorMessage } from '@/lib/errors';
import { isSettled, readWatchResponse, watchPath, type DojoWatch } from '@/lib/dojo/watch';

/** A turn takes an automated player a few seconds; this keeps the page close behind it. */
const POLL_MS = 2_000;

export interface DojoWatchState {
  /** The latest state, or `null` before the first answer and when the run does not exist. */
  run: DojoWatch | null;
  status: 'loading' | 'live' | 'finished' | 'not_found' | 'error';
  error: string | null;
}

/**
 * Follows a run for spectators by polling its read-only `watch` endpoint
 * every two seconds, and stops once the run is over and its memo is settled.
 * A failed poll keeps the last state on screen and tries again.
 */
export function useDojoWatch(runId: string, initial: DojoWatch | null = null): DojoWatchState {
  const [state, setState] = useState<DojoWatchState>({
    run: initial,
    status: initial ? (isSettled(initial) ? 'finished' : 'live') : 'loading',
    error: null,
  });
  const settled = state.status === 'finished' || state.status === 'not_found';

  useEffect(() => {
    if (settled) return;
    let active = true;
    const poll = async () => {
      try {
        const run = await readWatchResponse(await fetch(watchPath(runId), { cache: 'no-store' }));
        if (!active) return;
        setState(
          run
            ? { run, status: isSettled(run) ? 'finished' : 'live', error: null }
            : { run: null, status: 'not_found', error: null },
        );
      } catch (failure) {
        if (active) {
          setState((previous) => ({
            run: previous.run,
            status: previous.run ? 'live' : 'error',
            error: errorMessage(failure),
          }));
        }
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [runId, settled]);

  return state;
}
