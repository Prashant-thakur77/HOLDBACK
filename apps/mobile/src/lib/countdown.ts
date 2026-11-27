/**
 * Countdown math for the undo window. Everything takes the clock as an
 * argument so the ring, the text and the tests agree on one "now".
 */

/** Whole seconds until `releaseAt` (ISO string or unix seconds). Never negative. */
export function remainingSecs(releaseAt: string | number, nowMs: number): number {
  const releaseMs = toMs(releaseAt);
  if (!Number.isFinite(releaseMs)) return 0;
  return Math.max(0, Math.ceil((releaseMs - nowMs) / 1000));
}

/** Fraction of the window still left, 1 at creation and 0 at release. */
export function remainingFraction(
  createdAt: string | number,
  releaseAt: string | number,
  nowMs: number,
): number {
  const start = toMs(createdAt);
  const end = toMs(releaseAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(1, Math.max(0, (end - nowMs) / (end - start)));
}

export function toMs(value: string | number): number {
  return typeof value === 'number' ? value * 1000 : Date.parse(value);
}

export interface ClockParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function clockParts(totalSecs: number): ClockParts {
  const secs = Math.max(0, Math.floor(totalSecs));
  return {
    days: Math.floor(secs / 86_400),
    hours: Math.floor((secs % 86_400) / 3_600),
    minutes: Math.floor((secs % 3_600) / 60),
    seconds: secs % 60,
  };
}

const two = (value: number) => value.toString().padStart(2, '0');

/** `1d 02:03:04`, `02:03:04` or `03:04`. Digits only, so it needs no translation. */
export function formatClock(totalSecs: number): string {
  const { days, hours, minutes, seconds } = clockParts(totalSecs);
  if (days > 0) return `${days}d ${two(hours)}:${two(minutes)}:${two(seconds)}`;
  if (hours > 0) return `${two(hours)}:${two(minutes)}:${two(seconds)}`;
  return `${two(minutes)}:${two(seconds)}`;
}

export type Urgency = 'calm' | 'soon' | 'final' | 'over';

/** Last five minutes are `final`; the last quarter of the window (or last hour) is `soon`. */
export function urgency(remaining: number, totalSecs: number): Urgency {
  if (remaining <= 0) return 'over';
  if (remaining <= 300) return 'final';
  if (remaining <= Math.min(3_600, totalSecs / 4)) return 'soon';
  return 'calm';
}

/** Window length of a hold in whole seconds. */
export function totalWindowSecs(createdAt: string | number, releaseAt: string | number): number {
  const total = Math.round((toMs(releaseAt) - toMs(createdAt)) / 1000);
  return Number.isFinite(total) ? Math.max(0, total) : 0;
}
