import 'server-only';

import type { GuardianClient } from '@holdback/sdk';

import { serverEnv } from './env.server';
import { createGuardian, fetchWithTimeout } from './guardian';

/**
 * Longest the server waits for the agent. An assessment fans out to several
 * evidence sources; this leaves room for that while staying well inside what
 * a wallet or a Blink client will wait for.
 */
export const AGENT_TIMEOUT_MS = 20_000;

/** The agent client for server code, or `null` when no agent URL is configured. */
export function serverGuardian(): GuardianClient | null {
  return createGuardian({
    baseUrl: serverEnv().agentUrl,
    fetch: fetchWithTimeout(AGENT_TIMEOUT_MS),
  });
}
