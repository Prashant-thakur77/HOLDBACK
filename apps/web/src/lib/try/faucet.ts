import { z } from 'zod';

import { publicEnv } from '@/lib/env';
import { agentRequest } from '@/lib/guardian';

const grantSchema = z.object({
  address: z.string(),
  lamports: z.number(),
  signature: z.string(),
});

export type FaucetGrant = z.infer<typeof grantSchema>;

/**
 * Asks the risk agent's faucet for a little devnet SOL: enough for one hold,
 * its rent and the fees. One grant per address per day, two a minute per
 * visitor, and a daily cap; the agent answers 429 past any of them.
 */
export function requestDevnetSol(address: string): Promise<FaucetGrant> {
  if (!publicEnv.agentUrl) throw new Error('The risk agent is not configured for this site');
  return agentRequest('/v1/faucet', {
    baseUrl: publicEnv.agentUrl,
    body: { address },
    schema: grantSchema,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(45_000) }),
  });
}
