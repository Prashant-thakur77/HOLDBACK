/**
 * The tier table read backwards: from a length of time to the recipient the
 * policy gives that window to. Used by the footer's row of hours.
 */
export interface WindowFact {
  /** Plain name of the tier, e.g. "Someone new". */
  plain: string;
  windowSecs: number;
}

/** `30 minutes`, `1 hour`, `6 hours`. */
export function spokenHours(hours: number): string {
  return hours < 1 ? '30 minutes' : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** One sentence about which tier, if any, has a window of exactly this many hours. */
export function tierForHours(hours: number, windows: WindowFact[]): string {
  const tiers = windows
    .filter((item) => item.windowSecs > 0)
    .sort((a, b) => a.windowSecs - b.windowSecs);
  const seconds = hours * 3600;
  const exact = tiers.find((item) => item.windowSecs === seconds);
  if (exact) return `${spokenHours(hours)} is the window for ${exact.plain.toLowerCase()}.`;
  const next = tiers.find((item) => item.windowSecs > seconds);
  return next
    ? `No tier stops at ${spokenHours(hours)}. The next window up is ${spokenHours(next.windowSecs / 3600)}, for ${next.plain.toLowerCase()}.`
    : `No tier runs to ${spokenHours(hours)}.`;
}
