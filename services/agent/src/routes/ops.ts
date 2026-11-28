/** Endpoints called by other services with a shared secret. */
import { z } from 'zod';

import { grant } from '../chain/faucet';
import { dojoMemo, writeMemo } from '../chain/memo';
import { runMinute } from '../cron';
import { ApiError, unauthorized, unavailable } from '../errors';
import { timingSafeEqual } from '../lib/encoding';
import { body, evidenceHash, type App } from './shared';

const memoRequest = z.object({
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be a run id'),
  score: z.number().int().min(-1_000_000).max(1_000_000),
  historyHash: evidenceHash,
});

function requireSecret(
  expected: string | undefined,
  given: string | undefined,
  name: string,
): void {
  if (!expected) throw unavailable(`${name} is not configured`, 'secret_unavailable');
  if (!given || !timingSafeEqual(given, expected)) throw unauthorized('Wrong or missing secret');
}

const bearer = (header: string | undefined) => /^Bearer\s+(.+)$/i.exec(header ?? '')?.[1];

const faucetRequest = z.object({ address: z.string().min(32).max(44) });

export function opsRoutes(app: App): void {
  // Devnet SOL for a throwaway wallet on the Try it page; limited per address,
  // per IP (FAUCET_LIMITER) and per day.
  app.post('/v1/faucet', async (c) => {
    const limiter = c.env?.FAUCET_LIMITER;
    if (limiter) {
      const { success } = await limiter.limit({
        key: c.req.header('cf-connecting-ip') ?? 'unknown',
      });
      if (!success)
        throw new ApiError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
    }
    const request = await body(c, faucetRequest);
    return c.json(await grant(c.var.services, request.address));
  });

  // The same work the every-minute Cron Trigger does, for an external scheduler.
  app.post('/v1/crank', async (c) => {
    requireSecret(c.env.CRANK_SECRET, c.req.header('x-crank-secret'), 'CRANK_SECRET');
    const result = await runMinute(c.var.services);
    return c.json({
      released: result.crank?.released ?? [],
      closed: result.crank?.closed ?? [],
      errors: result.crank?.errors ?? [],
      notified: result.notified,
      crankKeyConfigured: result.crank !== null,
    });
  });

  // Writes `holdback-dojo:<run_id>:<score>:<historyHash>` on-chain for a finished Scam Dojo run.
  app.post('/v1/dojo/memo', async (c) => {
    requireSecret(c.env.DOJO_SECRET, bearer(c.req.header('authorization')), 'DOJO_SECRET');
    const { runId, score, historyHash } = await body(c, memoRequest);
    const signature = await writeMemo(c.var.services, dojoMemo(runId, score, historyHash));
    return c.json({ signature });
  });
}
