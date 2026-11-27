/**
 * Refreshes the static blocklists from a terminal. It runs the same code
 * as the hourly Cron Trigger; use it to load the lists the first time, or
 * on a Workers plan whose CPU limit is too small to parse the large lists.
 *
 *   npm run blocklists:refresh --workspace services/agent
 */
import { createServices } from '../src/services';
import { loadEnv, requireVar } from './env';

async function main(): Promise<void> {
  const env = loadEnv();
  requireVar(env, 'SUPABASE_URL');
  requireVar(env, 'SUPABASE_SERVICE_ROLE_KEY');
  const results = await createServices(env).storage.blocklists.refresh();
  for (const result of results) {
    const state = result.ok ? `${result.entries} entries` : `FAILED (${result.error})`;
    console.log(`${result.list} ${result.kind}: ${state}`);
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

void main();
