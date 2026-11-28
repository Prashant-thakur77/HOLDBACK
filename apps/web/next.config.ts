import { execSync } from 'node:child_process';
import fs from 'node:fs';
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

/**
 * Evaluation data and the devnet proofs, read once when the build starts and
 * compiled in as text. The Workers runtime has no file system, so the pages
 * cannot read these at request time. A file that does not exist yet becomes
 * an empty string and the page that prints it says so.
 */
function repoFile(relative: string): string {
  try {
    return fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
  } catch {
    return '';
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Title, description and share-image tags are sent in <head> to every client
  // rather than streamed into the body, so link previews and audits find them.
  htmlLimitedBots: /.*/,
  // The SDK and the Dojo engine are linked from the repository (`file:`
  // dependencies), so they are compiled and bundled like application code.
  transpilePackages: ['@holdback/sdk', '@holdback/dojo'],
  // Keep tracing inside this standalone project; the repository root has its
  // own lockfile and would otherwise be picked as the workspace root.
  outputFileTracingRoot: __dirname,
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: process.env.NEXT_PUBLIC_BUILD_COMMIT ?? buildCommit(),
    NEXT_PUBLIC_BUILD_TIME: process.env.NEXT_PUBLIC_BUILD_TIME ?? new Date().toISOString(),
    EVAL_PROGRAM_INVARIANTS: repoFile('eval/program_invariants.json'),
    EVAL_RESULTS: repoFile('eval/results.json'),
    PROOFS_DEVNET: repoFile('proofs/devnet.json'),
    PROOFS_BUILD: repoFile('proofs/build.json'),
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
  async redirects() {
    // The dashboard lives at /app; this is the address people guess.
    return [{ source: '/dashboard', destination: '/app', permanent: true }];
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
