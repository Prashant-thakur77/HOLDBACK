import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { isMetered, type RateLimiter } from '../src/ratelimit';

/** A limiter that allows `allowed` calls per key, then refuses. */
function countingLimiter(allowed: number): RateLimiter & { calls: string[] } {
  const seen = new Map<string, number>();
  const calls: string[] = [];
  return {
    calls,
    async limit({ key }) {
      calls.push(key);
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      return { success: count <= allowed };
    },
  };
}

describe('rate limiting', () => {
  it('meters only the routes that spend money', () => {
    expect(isMetered('POST', '/v1/assess')).toBe(true);
    expect(isMetered('POST', '/v1/holds/abc/reassess')).toBe(true);
    expect(isMetered('GET', '/v1/voice/note/abc')).toBe(true);
    expect(isMetered('GET', '/v1/evidence/abc')).toBe(false);
    expect(isMetered('GET', '/v1/holds/abc')).toBe(false);
    expect(isMetered('GET', '/')).toBe(false);
  });

  it('answers 429 once a caller is over the limit, per caller', async () => {
    const app = createApp();
    const limiter = countingLimiter(1);
    const send = (ip: string) =>
      app.request(
        '/v1/assess',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
          body: '{}',
        },
        { ASSESS_LIMITER: limiter },
      );

    // The first call passes the limiter and fails validation; the second is limited.
    expect((await send('1.1.1.1')).status).toBe(400);
    const limited = await send('1.1.1.1');
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: { code: 'rate_limited', message: 'Too many requests. Try again in a minute.' },
    });
    expect((await send('2.2.2.2')).status).toBe(400);
    expect(limiter.calls).toEqual(['1.1.1.1', '1.1.1.1', '2.2.2.2']);
  });

  it('never limits unmetered routes and works without the binding', async () => {
    const app = createApp();
    const limiter = countingLimiter(0);
    expect((await app.request('/', {}, { ASSESS_LIMITER: limiter })).status).toBe(200);
    expect(limiter.calls).toEqual([]);
    expect((await app.request('/v1/assess', { method: 'POST', body: '{}' }, {})).status).toBe(400);
  });
});
