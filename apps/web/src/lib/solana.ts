/**
 * Solana connections. Devnet is the default everywhere;
 * `NEXT_PUBLIC_SOLANA_CLUSTER` and the RPC variables move the whole app.
 */
import { Connection, type Commitment, type ConnectionConfig } from '@solana/web3.js';

import { rpcUrl } from './cluster';

export const DEFAULT_COMMITMENT: Commitment = 'confirmed';

/**
 * A connection for the browser, or for any caller that passes its own
 * endpoint. Server code uses `serverConnection()` from `solana.server.ts`,
 * which prefers the private RPC.
 */
export function createConnection(endpoint: string = rpcUrl(), config: ConnectionConfig = {}) {
  return new Connection(endpoint, { commitment: DEFAULT_COMMITMENT, ...config });
}
