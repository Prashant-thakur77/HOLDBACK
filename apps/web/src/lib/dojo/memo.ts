import 'server-only';

import type { DojoMemo } from '@holdback/dojo';
import { z } from 'zod';

import { serverEnv } from '../env.server';
import { IntegrationUnavailableError } from '../errors';
import { agentRequest, fetchWithTimeout } from '../guardian';

/** Kept under the Dojo handler's own memo timeout so the agent's answer is never cut off late. */
const MEMO_TIMEOUT_MS = 6_500;

const memoResponse = z.object({ signature: z.string().min(1) });

/**
 * Asks the agent to write the end-of-run Memo on Solana and returns the
 * transaction signature. The web app holds no signing key: the agent's crank
 * key signs, and the shared secret proves the request comes from this app.
 *
 * Throws when the agent or the secret is not configured; the Dojo handler
 * records the memo as unavailable and the run still finishes.
 */
export async function writeDojoMemo(memo: DojoMemo): Promise<string> {
  const { agentUrl, dojoSecret } = serverEnv();
  if (!agentUrl || !dojoSecret) {
    throw new IntegrationUnavailableError(
      'dojo-memo',
      'The agent URL and DOJO_SECRET are both needed to write the run memo',
    );
  }
  const { signature } = await agentRequest('/v1/dojo/memo', {
    baseUrl: agentUrl,
    body: memo,
    headers: { authorization: `Bearer ${dojoSecret}` },
    schema: memoResponse,
    fetch: fetchWithTimeout(MEMO_TIMEOUT_MS),
  });
  return signature;
}
