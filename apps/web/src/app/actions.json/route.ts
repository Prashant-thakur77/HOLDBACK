import { ACTIONS_JSON } from '@/lib/actions/rules';
import { actionJson, actionPreflight } from '@/lib/actions/spec';
import { publicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const GET = () => actionJson(ACTIONS_JSON, publicEnv.cluster);
export const OPTIONS = () => actionPreflight(publicEnv.cluster);
