/**
 * Server-only configuration. These values never reach the browser bundle:
 * the `server-only` import makes the build fail if a client component pulls
 * this module in.
 *
 * On Cloudflare the values are Worker secrets and variables, which exist per
 * request rather than at module load, so they are read lazily through
 * `serverEnv()` instead of being captured in a module constant.
 */
import 'server-only';

import { z } from 'zod';

import { EnvError, describeIssues, httpUrl, optional, publicEnv } from './env';

const serverSchema = z.object({
  AGENT_URL: optional(httpUrl),
  SOLANA_RPC_URL: optional(httpUrl),
  SUPABASE_SERVICE_ROLE_KEY: optional(z.string().trim().min(20)),
  DOJO_SECRET: optional(z.string().trim().min(16)),
});

export interface ServerEnv {
  /** Agent URL for server-to-server calls; falls back to the public one. */
  agentUrl: string | null;
  /** Private RPC (for example a keyed Helius URL); falls back to the public one. */
  rpcUrl: string | null;
  supabaseServiceRoleKey: string | null;
  /** Shared secret that authorises `POST /v1/dojo/memo` on the agent. */
  dojoSecret: string | null;
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverSchema.safeParse(source);
  if (!result.success) throw new EnvError('server', describeIssues(result.error));
  const env = result.data;
  return {
    agentUrl: env.AGENT_URL ?? publicEnv.agentUrl,
    rpcUrl: env.SOLANA_RPC_URL ?? publicEnv.rpcUrl,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    dojoSecret: env.DOJO_SECRET ?? null,
  };
}

export function serverEnv(): ServerEnv {
  return parseServerEnv({
    AGENT_URL: process.env.AGENT_URL,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DOJO_SECRET: process.env.DOJO_SECRET,
  });
}
