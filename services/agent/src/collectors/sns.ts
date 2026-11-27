/**
 * Collector 6: Solana Name Service. Finds the recipient's .sol names and
 * checks each for imitation of a well-known name. Also resolves a typed
 * name to an address for `GET /v1/names/:name`.
 */
import type { Env } from '../env';
import { UpstreamError, requestJson } from '../lib/http';
import type { Signal } from '../signals';
import { baseName, lookalikeOf } from './lookalike';
import type { Collector } from './types';

const DEFAULT_SNS_API = 'https://sdk-proxy-v2.sns.id';
const CACHE_TTL_SECS = 6 * 3_600;
/** Names checked per wallet. */
const MAX_NAMES = 10;

export interface RecipientNames {
  /** The wallet's primary name, without `.sol`. */
  primary: string | null;
  /** Every name the wallet owns, without `.sol`, primary first. */
  all: string[];
}

interface Envelope {
  s: 'ok' | 'error';
  result: unknown;
}

const apiBase = (env: Env) => (env.SNS_API_URL || DEFAULT_SNS_API).replace(/\/+$/, '');

async function call(env: Env, path: string): Promise<unknown> {
  const answer = (await requestJson(`${apiBase(env)}${path}`, { timeoutMs: 3_500 })) as Envelope;
  if (answer.s !== 'ok') throw new Error('SNS lookup failed');
  return answer.result;
}

/** Reverse lookup: the names a wallet owns. */
export async function namesOf(env: Env, wallet: string): Promise<RecipientNames> {
  const [favorite, owned] = await Promise.all([
    call(env, `/favorite-domain/${wallet}`).catch(() => null),
    call(env, `/domains/${wallet}`),
  ]);
  const primary = (favorite as { reverse?: string } | null)?.reverse ?? null;
  const others = (Array.isArray(owned) ? (owned as { domain?: string }[]) : [])
    .map((entry) => entry.domain)
    .filter((domain): domain is string => typeof domain === 'string');
  const all = [...new Set([...(primary ? [primary] : []), ...others])]
    .map(baseName)
    .slice(0, MAX_NAMES);
  return { primary: primary ? baseName(primary) : null, all };
}

/**
 * Forward lookup: the wallet behind `name`. The service is moving `.sol`
 * names to a `.sns` suffix; when it refuses `.sol` the same label is tried
 * as `.sns`. Returns `null` when the name does not exist.
 */
export async function resolveName(env: Env, name: string): Promise<string | null> {
  const label = baseName(name);
  if (!/^[a-z0-9_-]{1,63}$/.test(label)) return null;
  for (const suffix of ['sol', 'sns']) {
    try {
      const result = await call(env, `/resolve/${label}.${suffix}`);
      return typeof result === 'string' ? result : null;
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 404) return null;
      // 400 "Unsupported TLD": try the next suffix. Anything else is a real failure.
      if (!(error instanceof UpstreamError && error.status === 400)) throw error;
    }
  }
  return null;
}

/** Pure mapping from names to signals. */
export function nameSignals(names: RecipientNames): Signal[] {
  const source = 'sns' as const;
  const signals: Signal[] = [];
  for (const name of names.all) {
    const imitated = lookalikeOf(name);
    if (imitated) {
      signals.push({
        source,
        signal: 'lookalike_name',
        detail: `The wallet owns ${name}.sol, which imitates the well-known name ${imitated}.sol.`,
        matched: `${name}.sol`,
        url: `https://www.sns.id/domain/${name}`,
      });
    }
  }
  if (names.primary && signals.length === 0) {
    signals.push({
      source,
      signal: 'sol_name',
      detail: `The wallet's primary name is ${names.primary}.sol.`,
      matched: `${names.primary}.sol`,
    });
  }
  return signals;
}

/** Shared, cached lookup used by this collector and the web collector. */
export function cachedNames(
  cache: { wrap<T>(s: string, k: string, ttl: number, load: () => Promise<T>): Promise<T> },
  env: Env,
  wallet: string,
): Promise<RecipientNames> {
  return cache.wrap('sns', wallet, CACHE_TTL_SECS, () => namesOf(env, wallet));
}

export const snsCollector: Collector = {
  name: 'sns',
  timeoutMs: 4_000,
  cacheTtlSecs: CACHE_TTL_SECS,
  async collect({ names }) {
    const found = await names();
    if (!found) throw new Error('SNS lookup failed');
    return nameSignals(found);
  },
};
