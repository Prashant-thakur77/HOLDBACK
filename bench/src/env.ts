/**
 * Settings for local runs: the process environment, then
 * `services/agent/.dev.vars`, then the repo-root `.env`. Values are never
 * printed; `configuredKeys` reports names only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Credentials whose presence decides which collectors can answer. */
export const EVIDENCE_KEYS = [
  'HELIUS_API_KEY',
  'CHAINABUSE_API_KEY',
  'FIRECRAWL_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'MAINNET_RPC_URL',
  'SOLANA_RPC_URL',
] as const;

export function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function readIfPresent(path: string): Record<string, string> {
  return existsSync(path) ? parseDotenv(readFileSync(path, 'utf8')) : {};
}

/** Empty values count as unset, so a blank line in one file does not hide another file's value. */
export function loadEnv(): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    ...readIfPresent(join(repoRoot, '.env')),
    ...readIfPresent(join(repoRoot, 'services', 'agent', '.dev.vars')),
    ...process.env,
  };
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(merged)) {
    if (typeof value === 'string' && value !== '') env[name] = value;
  }
  return env;
}

export function configuredKeys(env: Record<string, string>): Record<string, boolean> {
  return Object.fromEntries(EVIDENCE_KEYS.map((name) => [name, name in env]));
}
