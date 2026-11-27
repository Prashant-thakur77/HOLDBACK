import { handlePayGet, handlePayPost, type PayActionDeps } from '@/lib/actions/pay';
import { actionPreflight } from '@/lib/actions/spec';
import { publicEnv } from '@/lib/env';
import { serverGuardian } from '@/lib/guardian.server';
import { serverConnection } from '@/lib/solana.server';

export const dynamic = 'force-dynamic';

function deps(): PayActionDeps {
  return {
    guardian: serverGuardian(),
    connection: serverConnection(),
    cluster: publicEnv.cluster,
  };
}

export const GET = (request: Request) => handlePayGet(request, deps());
export const POST = (request: Request) => handlePayPost(request, deps());
export const OPTIONS = () => actionPreflight(publicEnv.cluster);
