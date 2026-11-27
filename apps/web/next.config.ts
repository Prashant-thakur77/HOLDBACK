import { execSync } from 'node:child_process';
import path from 'node:path';

import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';

import { headerRules } from './src/lib/security-headers';

/** Short commit id for `/api/health`; `unknown` outside a git checkout. */
function buildCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

/**
 * The RPC origin the browser will call. Mirrors `rpcUrl()` in
 * `src/lib/cluster.ts`, which cannot be imported here because it validates
 * the whole environment on load.
 */
function browserRpcUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (configured) return configured;
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() || 'devnet';
  return cluster === 'localnet' ? 'http://127.0.0.1:8899' : `https://api.${cluster}.solana.com`;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The SDK and the Dojo engine are linked from the repository (`file:`
  // dependencies), so they are compiled and bundled like application code.
  transpilePackages: ['@holdback/sdk', '@holdback/dojo'],
  // Keep tracing inside this standalone project; the repository root has its
  // own lockfile and would otherwise be picked as the workspace root.
  outputFileTracingRoot: __dirname,
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: process.env.NEXT_PUBLIC_BUILD_COMMIT ?? buildCommit(),
    NEXT_PUBLIC_BUILD_TIME: process.env.NEXT_PUBLIC_BUILD_TIME ?? new Date().toISOString(),
  },
  webpack(config) {
    // The linked packages resolve `@solana/web3.js` from the repository root,
    // the app from its own node_modules. Two copies would break `instanceof`
    // checks on keys and transactions, so every import is pinned to the app's.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@solana/web3.js': path.resolve(__dirname, 'node_modules/@solana/web3.js'),
    };
    return config;
  },
  async headers() {
    const agent = process.env.NEXT_PUBLIC_AGENT_URL ?? null;
    const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
    return headerRules({
      connect: [agent, browserRpcUrl(), supabase],
      media: [agent, supabase],
      development: process.env.NODE_ENV === 'development',
    });
  },
};

export default nextConfig;

// Makes Cloudflare bindings available to `next dev`; a no-op for builds.
void initOpenNextCloudflareForDev();
