import { afterEach, describe, expect, it, vi } from 'vitest';

import { canonicalHistory, scenarioForRound } from '../src/engine';
import {
  createDojoHandler,
  DOJO_PLAYER_ADDRESS,
  DOJO_USDC_MINT,
  type DojoAssessRequest,
  type DojoHandlerOptions,
  type DojoMemo,
} from '../src/http';
import { RULES } from '../src/rules';
import { hmacSha256Hex, sha256Hex } from '../src/sha256';
import { memoryStore, type DojoStore } from '../src/stores';
import { MOVES, type DojoState, type Move, type RoundRecap } from '../src/types';

const BASE_URL = 'https://dojo.test/api/dojo';
const SECRET = 'test-secret-with-enough-length';
const LIMIT_BYTES = 64 * 1024;

type Body = DojoState & { error: string | null; play_token?: string; rounds?: RoundRecap[] };

interface Reply {
  status: number;
  body: Body;
  headers: Headers;
}

/** A handler on a memory store with a fake agent and a fake memo writer, plus a tiny client. */
function makeDojo(overrides: Partial<DojoHandlerOptions> = {}) {
  const assessed: DojoAssessRequest[] = [];
  const memos: DojoMemo[] = [];
  let largestResponse = 0;
  let calls = 0;
  const handler = createDojoHandler({
    store: memoryStore(),
    baseUrl: BASE_URL,
    secret: SECRET,
    assess: async (request) => {
      assessed.push(request);
      return {
        tier: 'SUSPICIOUS',
        score: 44,
        windowSecs: 21_600,
        spoken: { text: 'The message pushes urgency and the address is new.' },
      };
    },
    writeMemo: async (memo) => {
      memos.push(memo);
      return `sig-${memos.length}`;
    },
    ...overrides,
  });

  async function call(
    method: string,
    path: string,
    init: { body?: unknown; token?: string; raw?: string } = {},
  ): Promise<Reply> {
    const headers: Record<string, string> = {};
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.body !== undefined || init.raw !== undefined)
      headers['content-type'] = 'application/json';
    const response = await handler(
      new Request(`${BASE_URL}${path}`, {
        method,
        headers,
        body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
      }),
    );
    const text = await response.text();
    calls += 1;
    largestResponse = Math.max(largestResponse, Buffer.byteLength(text));
    expect(Buffer.byteLength(text), `${method} ${path}`).toBeLessThan(LIMIT_BYTES);
    return {
      status: response.status,
      body: (text ? JSON.parse(text) : null) as Body,
      headers: response.headers,
    };
  }

  async function start(player = 'byte') {
    const { body } = await call('POST', '/runs', { body: { player } });
    const token = body.play_token ?? '';
    const move = (name: unknown, turn?: unknown) =>
      call('POST', `/runs/${body.run_id}/moves`, { token, body: { move: name, turn } });
    return { run: body, id: body.run_id, token, move, seed: seedOf(body.run_id) };
  }

  return {
    handler,
    call,
    start,
    assessed,
    memos,
    stats: () => ({ largestResponse, calls }),
  };
}

/** The handler derives the seed from the secret, so a test can know the answers. */
const seedOf = (runId: string) => hmacSha256Hex(SECRET, `seed:${runId}`);

const rightCall = (seed: string, round: number): Move =>
  scenarioForRound(seed, round).truth === 'scam' ? 'refuse' : 'pay';

/** Plays a started run to the end with correct decisions after `investigate` each round. */
async function finish(
  game: Awaited<ReturnType<ReturnType<typeof makeDojo>['start']>>,
  investigate: Move[] = [],
): Promise<Body> {
  let state: Body = { ...game.run, error: null };
  while (!state.done) {
    for (const move of investigate) {
      if (state.legal_moves.includes(move)) state = (await game.move(move, state.turn)).body;
    }
    state = (await game.move(rightCall(game.seed, state.round), state.turn)).body;
    expect(state.error).toBeNull();
  }
  return state;
}

afterEach(() => vi.restoreAllMocks());

describe('starting and reading a run', () => {
  it('starts with one call that returns the whole state and the play token', async () => {
    const dojo = makeDojo();
    const { status, body, headers } = await dojo.call('POST', '/runs', {
      body: { player: '  <b>Byte</b> the 1st!  ' },
    });
    expect(status).toBe(200);
    expect(headers.get('content-type')).toContain('application/json');
    expect(headers.get('access-control-allow-origin')).toBe('*');
    expect(headers.get('cache-control')).toBe('no-store');
    expect(body.run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.play_token).toBe(hmacSha256Hex(SECRET, `play:${body.run_id}`));
    expect(body).toMatchObject({
      player: 'bByteb the 1st',
      status: 'playing',
      done: false,
      turn: 0,
      round: 1,
      max_rounds: 8,
      lives: 3,
      score: 0,
      win_score: RULES.winScore,
      legal_moves: [...MOVES],
      error: null,
      result: null,
    });
    expect(body.scenario?.transcript.length).toBeGreaterThan(0);
  });

  it('starts with an empty body too', async () => {
    const dojo = makeDojo();
    const { status, body } = await dojo.call('POST', '/runs');
    expect(status).toBe(200);
    expect(body.player).toBe('anonymous');
  });

  it('reads the state without side effects and without the token', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    await game.move('ask_question', 0);
    const first = await dojo.call('GET', `/runs/${game.id}`);
    const second = await dojo.call('GET', `/runs/${game.id}`, { token: game.token });
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(first.body.turn).toBe(1);
    expect(first.body.error).toBeNull();
    expect(JSON.stringify(first.body)).not.toContain(game.token);
    expect(first.body).not.toHaveProperty('play_token');
  });

  it('describes itself at the root and answers CORS preflights', async () => {
    const dojo = makeDojo();
    const root = await dojo.call('GET', '');
    expect(root.body).toMatchObject({ game: 'HOLDBACK Scam Dojo', moves: [...MOVES] });

    const preflight = await dojo.handler(
      new Request(`${BASE_URL}/runs/x/moves`, { method: 'OPTIONS' }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('answers 404 in JSON for unknown runs and paths', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    const unknown = [
      ['GET', '/runs/00000000-0000-4000-8000-000000000000'],
      ['GET', '/runs/not-a-uuid'],
      ['GET', '/runs'],
      ['POST', ''],
      ['GET', '/nothing'],
      ['GET', `/runs/${game.id}/moves`],
      ['POST', `/runs/${game.id}/watch`],
      ['GET', `/runs/${game.id}/watch/extra`],
    ] as const;
    for (const [method, path] of unknown) {
      const reply = await dojo.call(method, path);
      expect(reply.status, `${method} ${path}`).toBe(404);
      expect(typeof reply.body.error).toBe('string');
    }
    const outside = await dojo.handler(new Request('https://dojo.test/elsewhere/runs'));
    expect(outside.status).toBe(404);
  });

  it('refuses a secret that is too short to protect the answers', () => {
    expect(() => makeDojo({ secret: 'short' })).toThrow('at least 16 characters');
  });
});

describe('moves', () => {
  it('need the play token and still answer with the full state', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    for (const token of [undefined, 'wrong', game.token.slice(0, -1)]) {
      const reply = await dojo.call('POST', `/runs/${game.id}/moves`, {
        token,
        body: { move: 'refuse', turn: 0 },
      });
      expect(reply.status).toBe(401);
      expect(reply.body.error).toContain('play token');
      expect(reply.body.turn).toBe(0);
      expect(reply.body.scenario).not.toBeNull();
    }
  });

  it('reject illegal moves with 200, a reason in words and the full state', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    const before = (await dojo.call('GET', `/runs/${game.id}`)).body;

    const cases: [unknown, unknown, string][] = [
      ['dance', 0, 'Unknown move "dance". Legal moves: ask_question,'],
      [undefined, 0, 'Unknown move undefined.'],
      ['refuse', 3, 'Wrong turn: you sent 3, the run is at turn 0.'],
      ['refuse', 'soon', "turn must be the whole number in the state's turn field"],
      ['refuse', -1, 'turn must be the whole number'],
      ['refuse', 1.5, 'turn must be the whole number'],
    ];
    for (const [move, turn, message] of cases) {
      const reply = await game.move(move, turn);
      expect(reply.status).toBe(200);
      expect(reply.body.error).toContain(message);
      expect({ ...reply.body, error: null }).toEqual(before);
    }

    await game.move('verify_identity', 0);
    const again = await game.move('verify_identity', 1);
    expect(again.body.error).toContain('verify_identity is not available now');
    expect(again.body.turn).toBe(1);
  });

  it('answer 400 with the state for a body that is not a JSON object', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    for (const raw of ['{not json', '[1,2]', '"pay"', JSON.stringify({ move: 'x'.repeat(5000) })]) {
      const reply = await dojo.call('POST', `/runs/${game.id}/moves`, { token: game.token, raw });
      expect(reply.status).toBe(400);
      expect(reply.body.error).toContain('must be JSON');
      expect(reply.body.turn).toBe(0);
    }
  });

  it('are idempotent by turn: a retry changes nothing and says so', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    const first = await game.move('ask_question', 0);
    expect(first.body.error).toBeNull();
    expect(first.body.revealed_clues).toHaveLength(1);

    const retry = await game.move('ask_question', 0);
    expect(retry.status).toBe(200);
    expect(retry.body.error).toContain('Turn 0 was already played as ask_question');
    expect({ ...retry.body, error: null }).toEqual(first.body);

    const decision = await game.move('refuse', 1);
    const decisionRetry = await game.move('refuse', 1);
    expect(decisionRetry.body.round).toBe(2);
    expect({ ...decisionRetry.body, error: null }).toEqual(decision.body);
  });

  it('accept the turn as a number or a numeric string, and tolerate a missing one', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    expect((await game.move('ask_question', '0')).body.turn).toBe(1);
    expect((await game.move('verify_identity', ' 1 ')).body.turn).toBe(2);
    expect((await game.move('check_address', undefined)).body.turn).toBe(3);
    expect((await game.move('refuse', '')).body.turn).toBe(4);
    // A template variable the caller never filled in counts as "no turn".
    expect((await game.move('refuse', '{{turn}}')).body.turn).toBe(5);
  });

  it('apply only one of two simultaneous identical moves', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    const replies = await Promise.all([game.move('refuse', 0), game.move('refuse', 0)]);
    const errors = replies.map((reply) => reply.body.error);
    expect(errors.filter((error) => error === null)).toHaveLength(1);
    expect(errors.find((error) => error !== null)).toContain('Another request changed this run');
    for (const reply of replies) expect(reply.body.turn).toBe(1);
    expect((await dojo.call('GET', `/runs/${game.id}`)).body.history).toHaveLength(1);
  });
});

describe('check_address', () => {
  it('asks the real agent interface about the recipient and shows the verdict', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    const ask = game.run.scenario?.ask;
    const reply = await game.move('check_address', 0);

    expect(dojo.assessed).toEqual([
      {
        sender: DOJO_PLAYER_ADDRESS,
        recipient: ask?.to,
        mint: DOJO_USDC_MINT,
        amount: String((ask?.amount ?? 0) * 1_000_000),
        context: game.run.scenario?.transcript.join('\n'),
        lang: 'en',
      },
    ]);
    expect(reply.body.revealed_clues).toEqual([
      {
        source: 'address',
        text: expect.stringMatching(
          /^HOLDBACK risk agent on .{4}….{4}: tier SUSPICIOUS, risk score 44, undo window 6 h\. The message pushes urgency/,
        ),
      },
    ]);
    expect(reply.body.points_available).toBe(
      RULES.roundPoints - RULES.investigationCost.check_address,
    );
  });

  it('only calls the agent for a check that will be applied', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    await game.move('ask_question', 0);
    await game.move('check_address', 0); // stale turn
    await game.move('refuse', 1);
    expect(dojo.assessed).toHaveLength(0);
    await game.move('check_address', 2);
    await game.move('check_address', 3); // already used this round
    expect(dojo.assessed).toHaveLength(1);
  });

  it('stays fast and keeps the run alive when the agent hangs', async () => {
    const dojo = makeDojo({ assess: () => new Promise(() => {}), assessTimeoutMs: 40 });
    const game = await dojo.start();
    const started = Date.now();
    const reply = await game.move('check_address', 0);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(reply.status).toBe(200);
    expect(reply.body.error).toBeNull();
    expect(reply.body.revealed_clues[0]?.text).toContain('Verdict unavailable');
    expect(reply.body.points_available).toBe(RULES.roundPoints);
    expect(reply.body.legal_moves).not.toContain('check_address');
    expect((await game.move('refuse', 1)).body.round).toBe(2);
  });

  it.each([
    ['rejects', async () => Promise.reject(new Error('502 from agent'))],
    [
      'throws synchronously',
      () => {
        throw new Error('not configured');
      },
    ],
    ['answers with something else', async () => ({ error: 'rate limited' })],
    ['answers with null', async () => null],
  ])('reveals "verdict unavailable" when the agent %s', async (_name, assess) => {
    const dojo = makeDojo({ assess: assess as unknown as DojoHandlerOptions['assess'] });
    const game = await dojo.start();
    const reply = await game.move('check_address', 0);
    expect(reply.status).toBe(200);
    expect(reply.body.revealed_clues[0]?.text).toContain('Verdict unavailable');
    expect(reply.body.history[0]?.outcome).toBe('address_unavailable');
  });
});

describe('finishing a run', () => {
  it('plays eight rounds end to end, writes the memo and shows its signature', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    const final = await finish(game, ['check_address']);

    expect(final).toMatchObject({ status: 'won', done: true, rounds_survived: 8, lives: 3 });
    expect(final.score).toBe(8 * (RULES.roundPoints - RULES.investigationCost.check_address));
    const historyHash = sha256Hex(canonicalHistory(final.history));
    expect(dojo.memos).toEqual([{ runId: game.id, score: final.score, historyHash }]);
    expect(final.result).toMatchObject({
      outcome: 'won',
      score: final.score,
      history_sha256: historyHash,
      memo: `holdback-dojo:${game.id}:${final.score}:${historyHash}`,
      memo_status: 'written',
      memo_signature: 'sig-1',
    });
    expect(dojo.assessed).toHaveLength(8);
    expect(dojo.stats().calls).toBeLessThanOrEqual(400);
  });

  it('is sticky: the finished state keeps answering and nothing changes it', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    const final = await finish(game);
    const read = await dojo.call('GET', `/runs/${game.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(final);

    for (const [move, turn] of [
      ['pay', final.turn],
      ['refuse', final.turn - 1],
      ['ask_question', 0],
      ['check_address', undefined],
    ] as const) {
      const reply = await game.move(move, turn);
      expect(reply.status).toBe(200);
      expect(reply.body.error).toContain('The run is over (won');
      expect({ ...reply.body, error: null }).toEqual(final);
    }
    expect(dojo.memos).toHaveLength(1);
    expect((await dojo.call('GET', `/runs/${game.id}`)).body).toEqual(final);
  });

  it('ends as lost when the lives run out and still reports the result', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    let state: Body = { ...game.run, error: null };
    while (!state.done) {
      const wrong = rightCall(game.seed, state.round) === 'pay' ? 'refuse' : 'pay';
      state = (await game.move(wrong, state.turn)).body;
    }
    expect(state).toMatchObject({ status: 'lost', lives: 0, score: 0, round: 3 });
    expect(state.result).toMatchObject({ outcome: 'lost', reason: 'out_of_lives' });
    expect(state.result?.memo_signature).toBe('sig-1');
  });

  it('returns the result without a signature when the memo cannot be written', async () => {
    const dojo = makeDojo({
      writeMemo: async () => {
        throw new Error('devnet is down');
      },
    });
    const final = await finish(await dojo.start());
    expect(final.status).toBe('won');
    expect(final.result).toMatchObject({ memo_status: 'unavailable', memo_signature: null });
  });

  it('does not wait for a memo writer that hangs', async () => {
    const dojo = makeDojo({ writeMemo: () => new Promise(() => {}), memoTimeoutMs: 40 });
    const started = Date.now();
    const final = await finish(await dojo.start());
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(final.result?.memo_status).toBe('unavailable');
  });

  it('can retry the memo later through its own endpoint', async () => {
    let online = false;
    const written: DojoMemo[] = [];
    const dojo = makeDojo({
      writeMemo: async (memo) => {
        if (!online) throw new Error('devnet is down');
        written.push(memo);
        return 'sig-late';
      },
    });
    const game = await dojo.start();

    const early = await dojo.call('POST', `/runs/${game.id}/memo`, { token: game.token });
    expect(early.body.error).toContain('written when the run is over');

    const final = await finish(game);
    expect(final.result?.memo_status).toBe('unavailable');
    expect((await dojo.call('POST', `/runs/${game.id}/memo`)).status).toBe(401);

    online = true;
    const retried = await dojo.call('POST', `/runs/${game.id}/memo`, { token: game.token });
    expect(retried.body.result).toMatchObject({
      memo_status: 'written',
      memo_signature: 'sig-late',
    });
    expect(retried.body.turn).toBe(final.turn);

    await dojo.call('POST', `/runs/${game.id}/memo`, { token: game.token });
    expect(written).toHaveLength(1);
    expect((await dojo.call('GET', `/runs/${game.id}`)).body.result?.memo_signature).toBe(
      'sig-late',
    );
  });
});

describe('spectator view', () => {
  it('is public and adds the truth about every decided round, never the current one', async () => {
    const dojo = makeDojo();
    const game = await dojo.start();
    const opening = await dojo.call('GET', `/runs/${game.id}/watch`);
    expect(opening.status).toBe(200);
    expect(opening.body.rounds).toEqual([]);
    expect(opening.headers.get('access-control-allow-origin')).toBe('*');

    await game.move('ask_question', 0);
    await game.move(rightCall(game.seed, 1), 1);
    const watching = (await dojo.call('GET', `/runs/${game.id}/watch`)).body;
    const first = scenarioForRound(game.seed, 1);
    const current = scenarioForRound(game.seed, 2);

    expect(watching.rounds).toHaveLength(1);
    expect(watching.rounds?.[0]).toMatchObject({
      round: 1,
      scenario_id: first.id,
      was_scam: first.truth === 'scam',
      correct: true,
      tells: first.tells,
    });
    expect(watching.round).toBe(2);
    expect(watching).not.toHaveProperty('play_token');
    const text = JSON.stringify(watching);
    expect(text).not.toContain(current.id);
    expect(text).not.toContain(current.lesson);
  });
});

describe('limits and failures', () => {
  it('keeps every response under 64 KB and every run under 400 calls across many runs', async () => {
    const dojo = makeDojo();
    const everything: Move[] = [
      'ask_question',
      'ask_question',
      'ask_question',
      'ask_question',
      'verify_identity',
      'check_address',
    ];
    for (let i = 0; i < 25; i++) {
      const before = dojo.stats().calls;
      const game = await dojo.start(`runner-${i}`);
      // One state read per move, the way an agent loop polls.
      let state: Body = { ...game.run, error: null };
      while (!state.done) {
        for (const move of [...everything, rightCall(game.seed, state.round)]) {
          if (!state.legal_moves.includes(move)) continue;
          await game.move(move, state.turn);
          state = (await dojo.call('GET', `/runs/${game.id}`)).body;
        }
      }
      await dojo.call('GET', `/runs/${game.id}/watch`);
      expect(dojo.stats().calls - before).toBeLessThanOrEqual(400);
    }
    const { largestResponse, calls } = dojo.stats();
    console.log(
      `HTTP: ${calls} calls over 25 exhaustive runs, largest response ${largestResponse} bytes`,
    );
    expect(largestResponse).toBeLessThan(LIMIT_BYTES);
  });

  it('answers 503 in JSON when the store is down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: DojoStore = {
      get: async () => {
        throw new Error('database unreachable');
      },
      put: async () => {
        throw new Error('database unreachable');
      },
    };
    const dojo = makeDojo({ store: broken });
    for (const [method, path] of [
      ['POST', '/runs'],
      ['GET', '/runs/00000000-0000-4000-8000-000000000000'],
    ] as const) {
      const reply = await dojo.call(method, path);
      expect(reply.status).toBe(503);
      expect(reply.body.error).toContain('temporarily unavailable');
    }
  });
});
