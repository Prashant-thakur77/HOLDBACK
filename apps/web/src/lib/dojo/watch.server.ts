import 'server-only';

import { publicEnv } from '../env';
import { dojoHandler } from './handler';
import { readWatchResponse, watchPath, type DojoWatch } from './watch';

/**
 * Server loader for `/dojo/watch/[runId]`. It calls the Dojo handler in
 * process, through the same code path as the HTTP endpoint, so the page's
 * first render needs no request back to this server.
 */
export async function loadDojoWatch(runId: string): Promise<DojoWatch | null> {
  const origin = publicEnv.siteUrl;
  const response = await dojoHandler(origin)(new Request(`${origin}${watchPath(runId)}`));
  return readWatchResponse(response);
}
