/**
 * Per-caller limits on the routes that spend money on every call (model and
 * web-search credits, speech synthesis, list downloads). Uses the Workers Rate
 * Limiting binding; without the binding (local runs, tests) nothing is limited.
 */
import type { MiddlewareHandler } from 'hono';

import { ApiError } from './errors';
import type { AppEnv } from './routes/shared';

/** The shape of a Workers Rate Limiting binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Routes that cost money per call, by method and path prefix. */
const METERED: { method: string; prefix: string }[] = [
  { method: 'POST', prefix: '/v1/assess' },
  { method: 'POST', prefix: '/v1/holds/' },
  { method: 'POST', prefix: '/v1/flags' },
  { method: 'POST', prefix: '/v1/relay/auth/start' },
  { method: 'POST', prefix: '/v1/voice/' },
  { method: 'GET', prefix: '/v1/voice/note/' },
];

export function isMetered(method: string, path: string): boolean {
  return METERED.some((route) => route.method === method && path.startsWith(route.prefix));
}

export function rateLimit(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env?.ASSESS_LIMITER;
    if (limiter && isMetered(c.req.method, c.req.path)) {
      const caller = c.req.header('cf-connecting-ip') ?? 'unknown';
      const { success } = await limiter.limit({ key: caller });
      if (!success) {
        throw new ApiError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
      }
    }
    await next();
  };
}
