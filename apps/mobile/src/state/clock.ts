import { useSyncExternalStore } from 'react';

/**
 * One shared one-second ticker. Every countdown on screen reads the same
 * "now", so two rings never disagree by a second, and the interval only runs
 * while something is subscribed.
 */
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Milliseconds since the epoch, refreshed every second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
