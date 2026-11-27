/**
 * The spectator read of a Scam Dojo run: the full public state plus the
 * truth about every round already decided. It never changes the run.
 */
import type { DojoState, RoundRecap } from '@holdback/dojo';

export interface DojoWatch extends DojoState {
  error: string | null;
  /** One recap per decided round, in order. */
  rounds: RoundRecap[];
}

/** Path of the spectator endpoint for a run, relative to the site root. */
export function watchPath(runId: string): string {
  return `/api/dojo/runs/${encodeURIComponent(runId)}/watch`;
}

/** Reads the endpoint's response: the run, or `null` when there is no such run. */
export async function readWatchResponse(response: Response): Promise<DojoWatch | null> {
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Dojo watch failed with status ${response.status}`);
  const body = (await response.json()) as Partial<DojoWatch> | null;
  if (!body || typeof body.run_id !== 'string' || !Array.isArray(body.rounds)) {
    throw new Error('Dojo watch returned an unexpected body');
  }
  return body as DojoWatch;
}

/**
 * True when nothing about the run can change any more: it is over and the
 * memo has been written or given up on. Spectators stop polling here.
 */
export function isSettled(watch: DojoWatch): boolean {
  return watch.done && watch.result?.memo_status !== 'pending';
}
