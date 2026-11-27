import 'server-only';

import type { Connection } from '@solana/web3.js';

import { rpcUrl } from './cluster';
import { serverEnv } from './env.server';
import { createConnection } from './solana';

/**
 * Connection for route handlers and server loaders.
 *
 * `httpAgent: false` stops web3.js from creating a Node keep-alive agent,
 * which has no meaning on Workers, and the explicit `fetch` keeps every RPC
 * call on the platform's own fetch.
 *
 * On Cloudflare set `SOLANA_RPC_URL`: Workers mark their outgoing requests
 * with a `CF-Worker` header and the public Solana endpoints answer those
 * with 403, so the fallback only works in local development.
 */
export function serverConnection(): Connection {
  return createConnection(rpcUrl(serverEnv().rpcUrl), {
    httpAgent: false,
    fetch: (input, init) => fetch(input, init),
  });
}
