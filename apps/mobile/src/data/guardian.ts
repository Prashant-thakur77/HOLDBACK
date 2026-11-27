import { GuardianClient, GuardianError } from '@holdback/sdk';

import { config, hasAgent } from '@/config';

/**
 * The one agent client of the app. Its `token` is the relay session for a
 * Pollar user or the wallet session for a wallet user; whichever session is
 * active sets it.
 *
 * A build without an agent URL still gets a client, but every call rejects
 * immediately with `not_configured` instead of hanging on a bad host, so
 * screens show "unavailable" and fall back to reading the chain.
 */
export const guardian = new GuardianClient({
  baseUrl: hasAgent ? config.agentUrl : 'http://agent.invalid',
  fetch: (input, init) => {
    if (!hasAgent) {
      return Promise.reject(
        new GuardianError(0, 'not_configured', 'No Guardian server configured'),
      );
    }
    return fetch(input, init);
  },
});

/** True for an HTTP status that means "this server does not have that feature". */
export function isUnsupported(error: unknown): boolean {
  return error instanceof GuardianError && (error.status === 404 || error.status === 501);
}
