/**
 * Environment for the command-line scripts: the process environment, with
 * `.dev.vars` (the same file `wrangler dev` reads) filling in what is not
 * set. Values are never printed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Env } from '../src/env';

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    values[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

export function loadEnv(): Env {
  const file = join(packageRoot, '.dev.vars');
  const fromFile = existsSync(file) ? parseDotenv(readFileSync(file, 'utf8')) : {};
  return { ...fromFile, ...process.env } as Env;
}

export function requireVar(env: Env, name: keyof Env): string {
  const value = env[name];
  if (typeof value !== 'string' || value === '') {
    console.error(`${name} is not set. Add it to services/agent/.dev.vars or export it.`);
    process.exit(1);
  }
  return value;
}
