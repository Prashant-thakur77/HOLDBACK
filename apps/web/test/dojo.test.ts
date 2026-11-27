import type { DojoState } from '@holdback/dojo';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, OPTIONS, POST } from '@/app/api/dojo/[[...path]]/route';
import { dojoBackend } from '@/lib/dojo/handler';
import { writeDojoMemo } from '@/lib/dojo/memo';
import { isSettled, type DojoWatch } from '@/lib/dojo/watch';
import { loadDojoWatch } from '@/lib/dojo/watch.server';

const API = 'https://holdback.test/api/dojo';

type Started = DojoState & { error: string | null; play_token: string };

async function startRun(): Promise<Started> {
  const response = await POST(
    new Request(`${API}/runs`, { method: 'POST', body: JSON.stringify({ player: 'tester' }) }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Started;
}

function move(run: { run_id: string; play_token: string }, name: string, turn: number) {
  return POST(
    new Request(`${API}/runs/${run.run_id}/moves`, {
      method: 'POST',
      headers: { authorization: `Bearer ${run.play_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ move: name, turn }),
    }),
  );
}

beforeEach(() => {
  // No Supabase, no agent, no secret: the route must fall back to the memory store.
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  vi.stubEnv('DOJO_SECRET', '');
  vi.stubEnv('AGENT_URL', '');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/api/dojo with the memory store', () => {
  it('describes itself at the mount point', async () => {
    const response = await GET(new Request(API));
    expect(response.status).toBe(200);
    const index = (await response.json()) as { base_url: string; moves: string[] };
    expect(index.base_url).toBe(API);
    expect(index.moves).toContain('pay_with_holdback');
  });

  it('answers the CORS preflight', async () => {
    const response = await OPTIONS(new Request(`${API}/runs`, { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('starts a run with one call and returns the full state', async () => {
    const run = await startRun();
    expect(run.run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.play_token).toMatch(/^[0-9a-f]{64}$/);
    expect(run).toMatchObject({ player: 'tester', turn: 0, round: 1, done: false, error: null });
    expect(run.scenario?.transcript.length).toBeGreaterThan(0);
    expect(run.legal_moves).toContain('refuse');
  });

  it('plays moves, keeps reads free of side effects and is idempotent by turn', async () => {
    const run = await startRun();

    const read = async () =>
      (await (await GET(new Request(`${API}/runs/${run.run_id}`))).json()) as DojoState;
    expect((await read()).turn).toBe(0);
    expect((await read()).turn).toBe(0);

    // check_address needs the risk agent, which is not configured here: the
    // move is still accepted and reports the check as unavailable.
    const checked = (await (await move(run, 'check_address', 0)).json()) as DojoState;
    expect(checked.turn).toBe(1);
    expect(checked.history.at(-1)).toMatchObject({
      move: 'check_address',
      outcome: 'address_unavailable',
    });

    const decided = (await (await move(run, 'refuse', 1)).json()) as DojoState;
    expect(decided.turn).toBe(2);
    expect(decided.last_round?.decision).toBe('refuse');

    // The same move sent again for an old turn is not applied a second time.
    const replay = (await (await move(run, 'refuse', 1)).json()) as DojoState & { error: string };
    expect(replay.turn).toBe(2);
    expect(replay.history).toHaveLength(2);
  });

  it('refuses moves without the play token', async () => {
    const run = await startRun();
    const response = await move({ run_id: run.run_id, play_token: 'wrong' }, 'refuse', 0);
    expect(response.status).toBe(401);
    expect(((await response.json()) as DojoState).turn).toBe(0);
  });

  it('serves the spectator read through the route and the page loader', async () => {
    const run = await startRun();
    await move(run, 'refuse', 0);

    const response = await GET(new Request(`${API}/runs/${run.run_id}/watch`));
    const watched = (await response.json()) as DojoWatch;
    expect(watched.rounds).toHaveLength(1);
    expect(watched.rounds[0]).toMatchObject({ round: 1, decision: 'refuse' });
    expect(typeof watched.rounds[0]?.was_scam).toBe('boolean');
    expect(isSettled(watched)).toBe(false);

    const loaded = await loadDojoWatch(run.run_id);
    expect(loaded?.run_id).toBe(run.run_id);
    expect(loaded?.rounds).toEqual(watched.rounds);
    // Watching changed nothing.
    expect(loaded?.turn).toBe(1);

    expect(await loadDojoWatch('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await loadDojoWatch('not-a-run')).toBeNull();
  });

  it('finishes a run with the memo marked unavailable when the agent cannot write it', async () => {
    const run = await startRun();
    let state: DojoState = run;
    while (!state.done) {
      state = (await (await move(run, 'refuse', state.turn)).json()) as DojoState;
    }
    expect(state.result?.memo).toContain(`holdback-dojo:${run.run_id}:`);
    expect(state.result?.memo_status).toBe('unavailable');
    expect(state.result?.memo_signature).toBeNull();

    // The end is sticky: more moves are rejected and the state stays put.
    const after = (await (await move(run, 'pay', state.turn)).json()) as DojoState & {
      error: string | null;
    };
    expect(after.done).toBe(true);
    expect(after.turn).toBe(state.turn);
    expect(after.error).toBeTruthy();
    expect(isSettled((await loadDojoWatch(run.run_id))!)).toBe(true);
  });
});

describe('dojoBackend', () => {
  const supabase = { from: () => ({}) } as unknown as SupabaseClient;
  const secret = 's'.repeat(32);

  it('stores runs in Supabase only when the service role and the secret are both set', () => {
    expect(dojoBackend({ dojoSecret: secret }, supabase)).toMatchObject({
      persistent: true,
      secret,
    });
    expect(dojoBackend({ dojoSecret: null }, supabase).persistent).toBe(false);
    expect(dojoBackend({ dojoSecret: secret }, null)).toMatchObject({ persistent: false, secret });
  });

  it('keeps one memory store and one generated secret per process', () => {
    const first = dojoBackend({ dojoSecret: null }, null);
    const second = dojoBackend({ dojoSecret: null }, null);
    expect(second.store).toBe(first.store);
    expect(second.secret).toBe(first.secret);
    expect(first.secret.length).toBeGreaterThanOrEqual(32);
  });
});

describe('writeDojoMemo', () => {
  const memo = { runId: 'run-1', score: 640, historyHash: 'ab'.repeat(32) };

  it('posts the memo to the agent with the shared secret', async () => {
    vi.stubEnv('AGENT_URL', 'https://agent.test');
    vi.stubEnv('DOJO_SECRET', 's'.repeat(32));
    const fetchMock = vi.fn(async () => Response.json({ signature: 'memoSig' }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await writeDojoMemo(memo)).toBe('memoSig');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://agent.test/v1/dojo/memo');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${'s'.repeat(32)}`);
    expect(JSON.parse(init.body as string)).toEqual(memo);
  });

  it('fails without calling anything when the agent or the secret is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(writeDojoMemo(memo)).rejects.toThrow(/DOJO_SECRET/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an answer without a signature', async () => {
    vi.stubEnv('AGENT_URL', 'https://agent.test');
    vi.stubEnv('DOJO_SECRET', 's'.repeat(32));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: true })),
    );
    await expect(writeDojoMemo(memo)).rejects.toThrow(/Unexpected response/);
  });
});
