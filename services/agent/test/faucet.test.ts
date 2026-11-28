import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { dayKey, grant } from '../src/chain/faucet';
import type { Services } from '../src/services';

/** Just enough of Services for the faucet's checks; the chain is never reached. */
function services(env: Record<string, string>, cached: Record<string, unknown> = {}): Services {
  const store = new Map(Object.entries(cached));
  return {
    env,
    cache: {
      async get(source: string, subject: string) {
        return store.get(`${source}:${subject}`);
      },
      async set(source: string, subject: string, value: unknown) {
        store.set(`${source}:${subject}`, value);
      },
    },
    cluster: {
      sendTransaction: () => {
        throw new Error('the chain must not be reached in these tests');
      },
    },
  } as unknown as Services;
}

const faucet = Keypair.generate();
const env = { FAUCET_KEYPAIR: JSON.stringify(Array.from(faucet.secretKey)) };
const visitor = Keypair.generate().publicKey.toBase58();
const now = new Date('2026-11-29T10:00:00Z');

describe('faucet', () => {
  it('is unavailable without its own key', async () => {
    await expect(grant(services({}), visitor, now)).rejects.toMatchObject({
      status: 503,
      code: 'faucet_unavailable',
    });
  });

  it('refuses something that is not an address', async () => {
    await expect(grant(services(env), 'not-an-address', now)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_address',
    });
  });

  it('funds an address once a day', async () => {
    const cached = { [`faucet:${visitor}`]: 'earlier-signature' };
    await expect(grant(services(env, cached), visitor, now)).rejects.toMatchObject({
      status: 429,
      code: 'already_funded',
    });
  });

  it('stops at the daily total', async () => {
    const cached = { [`faucet_day:${dayKey(now)}`]: 3 };
    await expect(
      grant(services({ ...env, FAUCET_DAILY_GRANTS: '3' }, cached), visitor, now),
    ).rejects.toMatchObject({ status: 429, code: 'faucet_empty' });
  });
});
