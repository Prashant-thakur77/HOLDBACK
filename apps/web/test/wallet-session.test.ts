import { afterEach, describe, expect, it, vi } from 'vitest';

import { exchangeAuthSignature, requestAuthChallenge } from '@/lib/guardian';

const AGENT = 'https://agent.test';
const WALLET = 'So11111111111111111111111111111111111111112';

afterEach(() => vi.unstubAllGlobals());

describe('wallet sign-in against the agent', () => {
  it('requests a challenge and trades the signature for a session', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(init.body as string) });
        return url.endsWith('/v1/auth/challenge')
          ? Response.json({
              wallet: WALLET,
              message: 'Sign in to HOLDBACK',
              challenge: 'opaque.jwt.value',
              expiresAt: '2026-11-27T12:05:00.000Z',
            })
          : Response.json({
              token: 'session.jwt',
              wallet: WALLET,
              expiresAt: '2026-11-27T13:00:00.000Z',
            });
      }),
    );

    const challenge = await requestAuthChallenge(AGENT, WALLET);
    expect(challenge.message).toBe('Sign in to HOLDBACK');
    const session = await exchangeAuthSignature(AGENT, challenge, WALLET, 'base58signature');

    expect(session).toEqual({
      token: 'session.jwt',
      wallet: WALLET,
      expiresAt: '2026-11-27T13:00:00.000Z',
    });
    expect(calls).toEqual([
      { url: `${AGENT}/v1/auth/challenge`, body: { wallet: WALLET } },
      {
        url: `${AGENT}/v1/auth/session`,
        body: { wallet: WALLET, challenge: 'opaque.jwt.value', signature: 'base58signature' },
      },
    ]);
  });

  it("surfaces the agent's error code and message", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'auth_unavailable', message: 'SUPABASE_JWT_SECRET is not configured' } },
          { status: 503 },
        ),
      ),
    );
    await expect(requestAuthChallenge(AGENT, WALLET)).rejects.toMatchObject({
      status: 503,
      code: 'auth_unavailable',
    });
  });
});
