'use client';

import { formatDuration } from '@holdback/sdk';
import { useEffect, useState } from 'react';

export interface Countdown {
  /** Whole seconds left, or `null` before the first client tick. */
  remainingSecs: number | null;
  /** True once the release time has passed. */
  expired: boolean;
  /** `29 minutes 12 seconds`, or an empty string before the first tick. */
  label: string;
}

function toMillis(releaseAt: string | number | null): number | null {
  if (releaseAt === null) return null;
  // Numbers are unix seconds, as stored on-chain.
  const millis = typeof releaseAt === 'number' ? releaseAt * 1000 : Date.parse(releaseAt);
  return Number.isNaN(millis) ? null : millis;
}

/**
 * Seconds until a hold's release time, updated every second.
 *
 * The value starts as `null` and is set in an effect, so the server render
 * and the first client render agree and React does not report a mismatch.
 */
export function useCountdown(releaseAt: string | number | null): Countdown {
  const target = toMillis(releaseAt);
  const [remainingSecs, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (target === null) {
      setRemaining(null);
      return;
    }
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const left = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && timer) clearInterval(timer);
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [target]);

  return {
    remainingSecs,
    expired: remainingSecs === 0,
    label: remainingSecs === null ? '' : formatDuration(remainingSecs),
  };
}
