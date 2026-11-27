/**
 * The undo-window rule on the Send screen.
 *
 * The risk agent sets a policy window from the evidence. The sender may make
 * the window longer, but may only go below the policy when they have marked
 * the recipient as trusted on-chain. The program's configured minimum and
 * maximum bound everything.
 */

export interface WindowInputs {
  /** Window the risk agent asked for, in seconds. */
  policySecs: number;
  /** True when the sender's `Trust` account for this recipient exists. */
  trusted: boolean;
  /** `Config.min_window_secs` and `Config.max_window_secs`. */
  minSecs: number;
  maxSecs: number;
}

export interface WindowBounds {
  /** Shortest window the sender may choose. `0` means an instant transfer is allowed. */
  floor: number;
  ceiling: number;
}

/** Fallbacks used until the on-chain config has been read. They match the program defaults. */
export const DEFAULT_MIN_WINDOW_SECS = 0;
export const DEFAULT_MAX_WINDOW_SECS = 259_200;
export const DEFAULT_POLICY_WINDOW_SECS = 1_800;

const PRESET_SECS = [300, 1_800, 3_600, 21_600, 86_400, 259_200] as const;

export function windowBounds(inputs: WindowInputs): WindowBounds {
  const ceiling = Math.max(0, Math.floor(inputs.maxSecs));
  const minimum = Math.max(0, Math.floor(inputs.minSecs));
  const policy = Math.max(minimum, Math.floor(inputs.policySecs));
  const floor = inputs.trusted ? minimum : policy;
  return { floor: Math.min(floor, ceiling), ceiling };
}

/** Forces a requested window into the allowed range. */
export function clampWindow(requestedSecs: number, bounds: WindowBounds): number {
  if (!Number.isFinite(requestedSecs)) return bounds.floor;
  return Math.min(bounds.ceiling, Math.max(bounds.floor, Math.floor(requestedSecs)));
}

/** True when the sender is asking for less protection than they are allowed to. */
export function isBelowFloor(requestedSecs: number, bounds: WindowBounds): boolean {
  return requestedSecs < bounds.floor;
}

/**
 * The choices offered as chips: the floor itself, the policy window when the
 * sender is trusted and could go lower, and every longer preset up to the
 * ceiling. Sorted and without duplicates.
 */
export function windowOptions(inputs: WindowInputs): number[] {
  const bounds = windowBounds(inputs);
  const policy = clampWindow(inputs.policySecs, bounds);
  const options = new Set<number>([bounds.floor, policy]);
  for (const preset of PRESET_SECS) {
    if (preset > bounds.floor && preset <= bounds.ceiling) options.add(preset);
  }
  return [...options].sort((a, b) => a - b);
}

/** A zero-second window is sent as an instant transfer instead of a hold. */
export function isInstant(windowSecs: number): boolean {
  return windowSecs === 0;
}
