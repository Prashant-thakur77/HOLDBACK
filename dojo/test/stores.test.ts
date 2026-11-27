import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { startRun } from '../src/engine';
import {
  memoryStore,
  supabaseStore,
  type DojoRunRow,
  type DojoRunsTable,
  type DojoSupabaseClient,
} from '../src/stores';
import type { DojoState } from '../src/types';

const fresh = (runId = 'run-1'): DojoState => startRun({ runId, seed: 'seed' });

describe('memoryStore', () => {
  it('creates a run once and returns copies', async () => {
    const store = memoryStore();
    const state = fresh();
    expect(await store.get('run-1')).toBeNull();
    expect(await store.put(state, null)).toBe(true);
    expect(await store.put(state, null)).toBe(false);

    const loaded = await store.get('run-1');
    expect(loaded).toEqual(state);
    expect(loaded).not.toBe(state);
    state.score = 999;
    expect((await store.get('run-1'))?.score).toBe(0);
  });

  it('only saves when the stored run is at the expected turn', async () => {
    const store = memoryStore();
    await store.put(fresh(), null);
    expect(await store.put({ ...fresh(), turn: 1 }, 0)).toBe(true);
    expect(await store.put({ ...fresh(), turn: 1, score: 5 }, 0)).toBe(false);
    expect(await store.put({ ...fresh(), turn: 2 }, 1)).toBe(true);
    expect(await store.put({ ...fresh('missing'), turn: 1 }, 0)).toBe(false);
    expect((await store.get('run-1'))?.turn).toBe(2);
  });
});

/** An in-memory stand-in for the `dojo_runs` table that honours the filters the store sends. */
function fakeSupabase(failWith?: { message: string; code?: string }) {
  const rows = new Map<string, DojoRunRow>();
  const calls: string[] = [];
  const client: DojoSupabaseClient = {
    from(table): DojoRunsTable {
      return {
        select(columns) {
          return {
            eq(column, value) {
              return {
                async maybeSingle() {
                  calls.push(`select ${columns} from ${table} where ${column}=${value}`);
                  if (failWith) return { data: null, error: failWith };
                  const row = rows.get(value);
                  return { data: row ? { state: row.state } : null, error: null };
                },
              };
            },
          };
        },
        async insert(row) {
          calls.push(`insert into ${table}`);
          if (failWith) return { error: failWith };
          if (rows.has(row.run_id)) return { error: { message: 'duplicate key', code: '23505' } };
          rows.set(row.run_id, row);
          return { error: null };
        },
        update(changes) {
          return {
            eq(idColumn, runId) {
              return {
                eq(turnColumn, turn) {
                  return {
                    async select(columns) {
                      calls.push(
                        `update ${table} where ${idColumn}=${runId} and ${turnColumn}=${turn} returning ${columns}`,
                      );
                      if (failWith) return { data: null, error: failWith };
                      const row = rows.get(runId);
                      if (!row || String(row.state.turn) !== turn) return { data: [], error: null };
                      rows.set(runId, { ...row, ...changes });
                      return { data: [{ run_id: runId }], error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, rows, calls };
}

describe('supabaseStore', () => {
  it('writes the public state and the summary columns of dojo_runs', async () => {
    const { client, rows, calls } = fakeSupabase();
    const store = supabaseStore(client);
    const state = { ...fresh(), player: 'byte' };

    expect(await store.put(state, null)).toBe(true);
    expect(rows.get('run-1')).toEqual({
      run_id: 'run-1',
      player: 'byte',
      state,
      score: 0,
      done: false,
      result: null,
      memo_signature: null,
    });
    expect(await store.put(state, null)).toBe(false);
    expect(await store.get('run-1')).toEqual(state);
    expect(await store.get('nope')).toBeNull();
    expect(calls).toContain('select state from dojo_runs where run_id=run-1');
  });

  it('updates with a compare-and-set on the stored turn', async () => {
    const { client, rows, calls } = fakeSupabase();
    const store = supabaseStore(client);
    await store.put(fresh(), null);

    const moved: DojoState = { ...fresh(), turn: 1, score: 150 };
    expect(await store.put(moved, 0)).toBe(true);
    expect(calls).toContain(
      'update dojo_runs where run_id=run-1 and state->>turn=0 returning run_id',
    );
    expect(rows.get('run-1')?.score).toBe(150);
    // A second writer that also read turn 0 loses.
    expect(await store.put({ ...moved, score: 75 }, 0)).toBe(false);
    expect(rows.get('run-1')?.score).toBe(150);
  });

  it('mirrors the outcome and memo signature of a finished run', async () => {
    const { client, rows } = fakeSupabase();
    const store = supabaseStore(client);
    await store.put(fresh(), null);
    const finished = {
      ...fresh(),
      done: true,
      status: 'won',
      score: 1200,
      result: { outcome: 'won', memo_signature: '5sig' },
    } as unknown as DojoState;
    expect(await store.put(finished, 0)).toBe(true);
    expect(rows.get('run-1')).toMatchObject({
      done: true,
      score: 1200,
      result: 'won',
      memo_signature: '5sig',
    });
  });

  it('throws on database errors instead of pretending the run is missing', async () => {
    const store = supabaseStore(fakeSupabase({ message: 'connection refused' }).client);
    await expect(store.get('run-1')).rejects.toThrow('dojo_runs read failed: connection refused');
    await expect(store.put(fresh(), null)).rejects.toThrow('dojo_runs insert failed');
    await expect(store.put(fresh(), 0)).rejects.toThrow('dojo_runs update failed');
  });

  it('sends the expected PostgREST requests through the real supabase-js client', async () => {
    // The library builds the requests; only the network is replaced.
    const requests: {
      method: string;
      url: string;
      prefer: string;
      accept: string;
      body: unknown;
    }[] = [];
    const replies: Response[] = [];
    const client = createClient('https://project.supabase.co', 'service-role-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          requests.push({
            method: init?.method ?? 'GET',
            url: decodeURIComponent(String(input)),
            prefer: headers.get('prefer') ?? '',
            accept: headers.get('accept') ?? '',
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
          });
          return replies.shift() ?? new Response('[]', { status: 200 });
        },
      },
    });
    const store = supabaseStore(client);
    const state = fresh('0b0e4a52-8a55-4d1c-9a43-0c7a5f3b9a10');
    const reply = (status: number, body: unknown) =>
      new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    replies.push(reply(201, null));
    expect(await store.put(state, null)).toBe(true);
    replies.push(
      reply(409, { code: '23505', message: 'duplicate key value', details: '', hint: '' }),
    );
    expect(await store.put(state, null)).toBe(false);
    replies.push(reply(200, { state }));
    expect(await store.get(state.run_id)).toEqual(state);
    replies.push(reply(200, [{ run_id: state.run_id }]));
    expect(await store.put({ ...state, turn: 1 }, 0)).toBe(true);
    replies.push(reply(200, []));
    expect(await store.put({ ...state, turn: 1 }, 0)).toBe(false);

    const [insert, , select, update] = requests;
    expect(insert).toMatchObject({
      method: 'POST',
      url: 'https://project.supabase.co/rest/v1/dojo_runs',
      body: { run_id: state.run_id, player: 'anonymous', score: 0, done: false, result: null },
    });
    expect(select).toMatchObject({
      method: 'GET',
      url: `https://project.supabase.co/rest/v1/dojo_runs?select=state&run_id=eq.${state.run_id}`,
    });
    expect(update?.method).toBe('PATCH');
    expect(update?.url).toBe(
      `https://project.supabase.co/rest/v1/dojo_runs?run_id=eq.${state.run_id}&state->>turn=eq.0&select=run_id`,
    );
    expect(update?.prefer).toContain('return=representation');
    expect(update?.body).toMatchObject({ score: 0, done: false });
    expect(update?.body).not.toHaveProperty('run_id');
  });
});
