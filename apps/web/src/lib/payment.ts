/**
 * Turns the agent's verdict into what is actually built on-chain. Shared by
 * the dashboard's send flow and the Solana Action so both size a payment the
 * same way.
 */
import {
  Tier,
  WINDOW_SECS_BY_TIER,
  fetchConfig,
  isTrusted,
  type AssessResponse,
} from '@holdback/sdk';
import type { Connection, PublicKey } from '@solana/web3.js';

export interface PaymentPlan {
  /** Tier index written on-chain. */
  tier: number;
  /** `0` only for the instant path. */
  windowSecs: number;
  /** True when the payment skips the hold and goes straight to the recipient. */
  instant: boolean;
}

/** The window a recipient gets when nothing is known about them. */
const STANDARD_WINDOW_SECS = WINDOW_SECS_BY_TIER[Tier.UNKNOWN];

/**
 * The agent may answer "no window" for a recipient it considers trusted, but
 * the program only allows a zero-window transfer when the sender's `Trust`
 * account for that recipient exists on-chain. So:
 *
 * - a positive window is used as given;
 * - a zero window with the `Trust` account becomes an instant transfer;
 * - a zero window without it becomes a hold with the standard window for an
 *   unknown recipient: trust the sender has not recorded on-chain does not
 *   shorten the time to undo. The sender can still release early. The window
 *   is raised to `Config.min_window_secs` if the program demands more.
 */
export async function planPayment(
  connection: Connection,
  assessment: Pick<AssessResponse, 'tierIndex' | 'windowSecs'>,
  sender: PublicKey,
  recipient: PublicKey,
): Promise<PaymentPlan> {
  const tier = assessment.tierIndex;
  if (assessment.windowSecs > 0) {
    return { tier, windowSecs: assessment.windowSecs, instant: false };
  }
  if (await isTrusted(connection, sender, recipient)) {
    return { tier, windowSecs: 0, instant: true };
  }
  const config = await fetchConfig(connection);
  const windowSecs = Math.max(STANDARD_WINDOW_SECS, config?.minWindowSecs ?? 0);
  return { tier, windowSecs, instant: false };
}
