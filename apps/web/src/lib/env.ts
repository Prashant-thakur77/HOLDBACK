/**
 * Public configuration: values that are safe to ship to the browser.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, and only when
 * each variable is written out literally, which is why `readPublicEnv` lists
 * them one by one instead of passing `process.env` around.
 *
 * A missing optional value turns the matching integration off (the code
 * reports "unavailable"). A malformed value throws: a typo in a URL should
 * fail the build, not surface as a broken page.
 */
import { z } from 'zod';

// The site's Content-Security-Policy forbids `eval`. Zod otherwise probes for
// it once to decide whether to compile parsers, the browser refuses, and the
// refusal is reported as a policy violation on every page.
z.config({ jitless: true });

export const CLUSTERS = ['devnet', 'testnet', 'mainnet-beta', 'localnet'] as const;
export type Cluster = (typeof CLUSTERS)[number];

/** Treats unset and empty variables alike, so `KEY=` in a .env file means "not set". */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/** An http(s) URL without a trailing slash. */
export const httpUrl = z
  .string()
  .trim()
  .refine((value) => /^https?:\/\/[^\s/]+/i.test(value) && URL.canParse(value), {
    message: 'must be an http(s) URL',
  })
  .transform((value) => value.replace(/\/+$/, ''));

export const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.preprocess(blankToUndefined, httpUrl.default('http://localhost:3000')),
  NEXT_PUBLIC_AGENT_URL: optional(httpUrl),
  NEXT_PUBLIC_SOLANA_CLUSTER: z.preprocess(blankToUndefined, z.enum(CLUSTERS).default('devnet')),
  NEXT_PUBLIC_SOLANA_RPC_URL: optional(httpUrl),
  NEXT_PUBLIC_SUPABASE_URL: optional(httpUrl),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional(z.string().trim().min(20)),
  NEXT_PUBLIC_BUILD_COMMIT: z.preprocess(blankToUndefined, z.string().default('unknown')),
  NEXT_PUBLIC_BUILD_TIME: z.preprocess(blankToUndefined, z.string().default('unknown')),
});

export interface PublicEnv {
  /** Canonical origin of this site, used for metadata, the sitemap and Action icons. */
  siteUrl: string;
  /** Base URL of the risk agent, or `null` when it is not configured. */
  agentUrl: string | null;
  cluster: Cluster;
  /** Browser-facing RPC endpoint, or `null` to use the cluster's public one. */
  rpcUrl: string | null;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  build: { commit: string; time: string };
}

export class EnvError extends Error {
  constructor(
    scope: 'public' | 'server',
    readonly issues: string[],
  ) {
    super(`Invalid ${scope} environment: ${issues.join('; ')}`);
    this.name = 'EnvError';
  }
}

/** Flattens zod issues to `NAME: reason`. Values are never included, so secrets cannot leak. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`);
}

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicSchema.safeParse(source);
  if (!result.success) throw new EnvError('public', describeIssues(result.error));
  const env = result.data;
  return {
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
    agentUrl: env.NEXT_PUBLIC_AGENT_URL ?? null,
    cluster: env.NEXT_PUBLIC_SOLANA_CLUSTER,
    rpcUrl: env.NEXT_PUBLIC_SOLANA_RPC_URL ?? null,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
    build: { commit: env.NEXT_PUBLIC_BUILD_COMMIT, time: env.NEXT_PUBLIC_BUILD_TIME },
  };
}

function readPublicEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_AGENT_URL: process.env.NEXT_PUBLIC_AGENT_URL,
    NEXT_PUBLIC_SOLANA_CLUSTER: process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
    NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_BUILD_COMMIT: process.env.NEXT_PUBLIC_BUILD_COMMIT,
    NEXT_PUBLIC_BUILD_TIME: process.env.NEXT_PUBLIC_BUILD_TIME,
  };
}

export const publicEnv: PublicEnv = parsePublicEnv(readPublicEnv());
