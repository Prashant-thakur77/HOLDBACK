/**
 * Runs both benchmarks and writes `bench/results.json`.
 *
 *   npx tsx bench/src/run.ts
 *
 * Settings (all optional):
 *   GUARDIAN_URL         benchmark a deployed Guardian; default starts one in this process
 *   BENCH_ASSESS_N       requests per phase (default 30)
 *   BENCH_ASSESS_PAUSE_MS  pause between requests, not timed (default 1000)
 *   BENCH_CHAIN_N        hold/undo round trips on devnet (default 5; 0 skips the chain part)
 *   SOLANA_RPC_URL       devnet RPC (default: services/agent/.dev.vars, then the public endpoint)
 *
 * A part that cannot run is written as `available: false` with the reason.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'prettier';

import { benchAssess, type AssessBench } from './assess';
import { benchChain, type ChainBench } from './chain';
import { configuredKeys, loadEnv, repoRoot } from './env';
import { startGuardian } from './guardian-server';

const PUBLIC_DEVNET_RPC = 'https://api.devnet.solana.com';
const CHAIN_COOLDOWN_MS = 15_000;

function count(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const assessRequests = count(env.BENCH_ASSESS_N, 30);
  const assessPauseMs = count(env.BENCH_ASSESS_PAUSE_MS, 1_000);
  const chainIterations = count(env.BENCH_CHAIN_N, 5);

  const remote = env.GUARDIAN_URL?.replace(/\/+$/, '');
  const local = remote ? null : await startGuardian(env);
  let assess: AssessBench | { available: false; reason: string };
  try {
    assess = await benchAssess(remote ?? local!.url, assessRequests, assessPauseMs);
  } catch (error) {
    assess = { available: false, reason: error instanceof Error ? error.message : 'failed' };
  } finally {
    await local?.close();
  }

  // Let the RPC endpoint's rate-limit window from the assessments pass before timing the chain.
  if (chainIterations > 0) await new Promise((resolve) => setTimeout(resolve, CHAIN_COOLDOWN_MS));
  let chain: ChainBench;
  if (chainIterations === 0) {
    chain = { available: false, reason: 'skipped (BENCH_CHAIN_N=0)' };
  } else {
    try {
      chain = await benchChain({
        rpcUrl: env.SOLANA_RPC_URL ?? env.HELIUS_DEVNET_RPC ?? PUBLIC_DEVNET_RPC,
        funderPath: join(repoRoot, 'keys', 'deployer.json'),
        iterations: chainIterations,
      });
    } catch (error) {
      // web3.js errors can quote the RPC URL, which may carry an API key: keep the name only.
      const kind = error instanceof Error ? error.name : 'error';
      chain = { available: false, reason: `the devnet run stopped early (${kind})` };
    }
  }

  const results = {
    generated_at: new Date().toISOString(),
    environment: {
      guardian: remote
        ? { mode: 'remote', host: new URL(remote).hostname }
        : { mode: 'local Node process', host: '127.0.0.1', configured: configuredKeys(env) },
      node: process.version,
    },
    assess,
    chain,
  };
  const path = join(repoRoot, 'bench', 'results.json');
  writeFileSync(path, await format(JSON.stringify(results), { parser: 'json', printWidth: 100 }));
  console.log(`wrote bench/results.json`);
  if ('cold' in assess) {
    console.log(
      `assess cold p50 ${assess.cold.p50_ms} ms, p95 ${assess.cold.p95_ms} ms (n = ${assess.cold.n})`,
    );
    console.log(
      `assess warm p50 ${assess.warm.p50_ms} ms, p95 ${assess.warm.p95_ms} ms (n = ${assess.warm.n})`,
    );
  }
  if (chain.available) {
    console.log(`create_hold p50 ${chain.create_hold.p50_ms} ms (n = ${chain.create_hold.n})`);
    console.log(`reclaim p50 ${chain.reclaim.p50_ms} ms (n = ${chain.reclaim.n})`);
  } else {
    console.log(`chain benchmark not run: ${chain.reason}`);
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.name : 'bench failed');
    process.exit(1);
  },
);
