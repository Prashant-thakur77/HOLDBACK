import { PROGRAM_ID } from '@holdback/sdk';

import { publicEnv } from '@/lib/env';
import { serverEnv } from '@/lib/env.server';

export const dynamic = 'force-dynamic';

/**
 * Liveness and configuration report. Integrations are reported as booleans
 * only: this endpoint is public, so it says whether a key is set and never
 * anything about its value.
 */
export function GET(): Response {
  const server = serverEnv();
  const supabaseUrl = publicEnv.supabaseUrl !== null;
  return Response.json(
    {
      status: 'ok',
      service: 'holdback-web',
      build: publicEnv.build,
      runtime: globalThis.navigator?.userAgent === 'Cloudflare-Workers' ? 'workerd' : 'node',
      cluster: publicEnv.cluster,
      programId: PROGRAM_ID.toBase58(),
      integrations: {
        agent: server.agentUrl !== null,
        customRpc: server.rpcUrl !== null,
        supabaseAnon: supabaseUrl && publicEnv.supabaseAnonKey !== null,
        supabaseServiceRole: supabaseUrl && server.supabaseServiceRoleKey !== null,
        dojoMemo: server.agentUrl !== null && server.dojoSecret !== null,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
