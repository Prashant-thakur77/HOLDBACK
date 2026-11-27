import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';

import { assess } from '../assess';
import { reassessHold } from '../chain/oracle';
import { MAX_CONTEXT_CHARS } from '../collectors/context';
import { ApiError, badRequest } from '../errors';
import { address, amount, body, lang, parse, type App } from './shared';

const assessRequest = z.object({
  sender: address,
  recipient: address,
  mint: address.nullable(),
  amount,
  context: z.string().max(MAX_CONTEXT_CHARS).optional(),
  lang,
});

/** Minimum seconds between two re-assessments of the same hold from this isolate. */
const REASSESS_COOLDOWN_SECS = 60;

export function assessRoutes(app: App): void {
  app.post('/v1/assess', async (c) => {
    const request = await body(c, assessRequest);
    if (request.sender === request.recipient) {
      throw badRequest('sender and recipient must differ', 'self_transfer');
    }
    const response = await assess(c.var.services, {
      ...request,
      amount: BigInt(request.amount),
    });
    return c.json(response);
  });

  app.post('/v1/holds/:pda/reassess', async (c) => {
    const pda = parse(address, c.req.param('pda'));
    const { cache } = c.var.services;
    if (!(await cache.claimOnce(`reassess:${pda}`, REASSESS_COOLDOWN_SECS))) {
      throw new ApiError(429, 'too_soon', 'This hold was re-assessed a moment ago');
    }
    return c.json(await reassessHold(c.var.services, new PublicKey(pda)));
  });
}
