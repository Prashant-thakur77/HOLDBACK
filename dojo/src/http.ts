/**
 * The HTTP face of the Dojo, written against the Fetch API only so the same
 * handler runs in a Next.js route, a Cloudflare Worker or a plain Node server.
 *
 * Contract with an automated player:
 * - every response for an existing run carries the complete state plus `error`
 * - a rule violation (illegal move, wrong turn, finished run) answers 200 with
 *   `error` in words, so the player can read it and recover
 * - reads never change anything; finished runs keep answering
 * - a move carries the `turn` it was decided on, so a retry is never applied twice
 */
import { applyMove, attachMemo, checkMove, revealRounds, startRun } from './engine';
import { RULES } from './rules';
import { hmacSha256Hex } from './sha256';
import type { DojoStore } from './stores';
import { MOVES, type AddressCheck, type DojoState } from './types';

/** Structurally the risk agent's `POST /v1/assess` request. */
export interface DojoAssessRequest {
  sender: string;
  recipient: string;
  /** Mint address, or `null` for native SOL. */
  mint: string | null;
  /** Base units, as a decimal string. */
  amount: string;
  /** The message the player received, so the agent can weigh its wording. */
  context: string;
  lang: 'en' | 'hi' | 'es' | 'pt';
}

/** The fields of the agent's answer that the game shows. */
export interface DojoAssessVerdict {
  tier: string;
  score: number;
  windowSecs: number;
  spoken: { text: string };
}

export type DojoAssess = (request: DojoAssessRequest) => Promise<DojoAssessVerdict>;

export interface DojoMemo {
  runId: string;
  score: number;
  /** sha256 of the canonical history, hex. */
  historyHash: string;
}

/** Writes the end-of-run Memo on Solana and resolves with its signature. */
export type DojoMemoWriter = (memo: DojoMemo) => Promise<string>;

export interface DojoHandlerOptions {
  store: DojoStore;
  assess: DojoAssess;
  writeMemo: DojoMemoWriter;
  /** Public URL the API is mounted at, e.g. `https://example.org/api/dojo`. */
  baseUrl: string;
  /**
   * Server secret. Each run's seed and play token are derived from it, so
   * neither has to be stored next to the publicly readable state.
   */
  secret: string;
  /** Address used as the paying wallet when asking the agent. */
  sender?: string;
  /** Mint the practice payments are denominated in. */
  mint?: string | null;
  /** Longest wait for the risk agent before a check counts as unavailable. */
  assessTimeoutMs?: number;
  /** Longest wait for the memo before the result is returned without it. */
  memoTimeoutMs?: number;
  newRunId?: () => string;
}

/** Circle's devnet USDC, the unit the practice wallet is counted in. */
export const DOJO_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
/** A throwaway address that stands in for the practice player's wallet. */
export const DOJO_PLAYER_ADDRESS = 'BfFFXVT6WYDTzvejUhky6ptmxNNG4a2AcyAV7i44K3LL';

const USDC_DECIMALS = 6;
const MIN_SECRET_CHARS = 16;
const MAX_BODY_CHARS = 4_096;
const MAX_PLAYER_CHARS = 32;
const MAX_CONTEXT_CHARS = 1_500;
/** Together with store round-trips these stay well under a 12 s call limit. */
const DEFAULT_TIMEOUT_MS = 7_000;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  // The spectator page may be served from another origin than the API.
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function withState(state: DojoState, error: string | null = null, status = 200): Response {
  return json(status, { ...state, error });
}

/** Rejects when `work` takes longer than `ms`. A late result is ignored. */
function withTimeout<T>(work: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    Promise.resolve()
      .then(work)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

function sameText(a: string, b: string): boolean {
  // Constant-time for equal lengths, so the token cannot be guessed by timing.
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function cleanPlayer(value: unknown): string {
  if (typeof value !== 'string') return 'anonymous';
  const cleaned = value
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim()
    .slice(0, MAX_PLAYER_CHARS);
  return cleaned || 'anonymous';
}

type ParsedTurn = { ok: true; turn: number | null } | { ok: false };

/**
 * Accepts a number or a numeric string. A missing or empty value, or a
 * template placeholder that was never filled in, means "no turn given".
 */
function parseTurn(value: unknown): ParsedTurn {
  if (value === undefined || value === null) return { ok: true, turn: null };
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? { ok: true, turn: value } : { ok: false };
  }
  if (typeof value !== 'string') return { ok: false };
  const text = value.trim();
  if (text === '' || /^\{\{.*\}\}$/.test(text)) return { ok: true, turn: null };
  return /^\d{1,6}$/.test(text) ? { ok: true, turn: Number(text) } : { ok: false };
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return null;
  if (text.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isVerdict(value: unknown): value is DojoAssessVerdict {
  const verdict = value as Partial<DojoAssessVerdict> | null;
  return (
    typeof verdict === 'object' &&
    verdict !== null &&
    typeof verdict.tier === 'string' &&
    Number.isFinite(verdict.score) &&
    Number.isFinite(verdict.windowSecs)
  );
}

export function createDojoHandler(
  options: DojoHandlerOptions,
): (request: Request) => Promise<Response> {
  if (options.secret.length < MIN_SECRET_CHARS) {
    throw new Error(`The Dojo secret must be at least ${MIN_SECRET_CHARS} characters long`);
  }
  const { store, secret } = options;
  const prefix = new URL(options.baseUrl).pathname.replace(/\/+$/, '');
  const sender = options.sender ?? DOJO_PLAYER_ADDRESS;
  const mint = options.mint === undefined ? DOJO_USDC_MINT : options.mint;
  const assessTimeoutMs = options.assessTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoTimeoutMs = options.memoTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const newRunId = options.newRunId ?? (() => crypto.randomUUID());

  const seedFor = (runId: string) => hmacSha256Hex(secret, `seed:${runId}`);
  const tokenFor = (runId: string) => hmacSha256Hex(secret, `play:${runId}`);

  function holdsPlayToken(request: Request, runId: string): boolean {
    const header = request.headers.get('authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '');
    return sameText(token, tokenFor(runId));
  }

  /** Asks the risk agent about the current recipient. Never throws. */
  async function checkAddress(state: DojoState): Promise<AddressCheck> {
    const scenario = state.scenario;
    if (!scenario) return { available: false };
    try {
      const verdict: unknown = await withTimeout(
        () =>
          options.assess({
            sender,
            recipient: scenario.ask.to,
            mint,
            amount: String(Math.round(scenario.ask.amount * 10 ** USDC_DECIMALS)),
            context: scenario.transcript.join('\n').slice(0, MAX_CONTEXT_CHARS),
            lang: 'en',
          }),
        assessTimeoutMs,
      );
      if (!isVerdict(verdict)) return { available: false };
      return {
        available: true,
        tier: verdict.tier,
        score: verdict.score,
        window_secs: verdict.windowSecs,
        summary: typeof verdict.spoken?.text === 'string' ? verdict.spoken.text : '',
      };
    } catch {
      return { available: false };
    }
  }

  /** Tries to write the memo once and saves the outcome either way. */
  async function settleMemo(state: DojoState): Promise<DojoState> {
    const result = state.result;
    if (!result) return state;
    let signature: string | null = null;
    try {
      const written: unknown = await withTimeout(
        () =>
          options.writeMemo({
            runId: state.run_id,
            score: result.score,
            historyHash: result.history_sha256,
          }),
        memoTimeoutMs,
      );
      signature = typeof written === 'string' && written !== '' ? written : null;
    } catch {
      signature = null;
    }
    const settled = attachMemo(state, signature);
    if (await store.put(settled, settled.turn)) return settled;
    return (await store.get(state.run_id)) ?? settled;
  }

  async function start(request: Request): Promise<Response> {
    const body = await readJsonObject(request);
    if (!body) return json(400, { error: 'The request body must be a small JSON object.' });
    const runId = newRunId();
    const state = startRun({ runId, seed: seedFor(runId), player: cleanPlayer(body.player) });
    if (!(await store.put(state, null))) throw new Error(`Run id ${runId} already exists`);
    return json(200, { ...state, error: null, play_token: tokenFor(state.run_id) });
  }

  async function move(request: Request, state: DojoState): Promise<Response> {
    if (!holdsPlayToken(request, state.run_id)) {
      return withState(
        state,
        'Missing or wrong play token. Send "Authorization: Bearer <play_token>" using the play_token returned when the run was started.',
        401,
      );
    }
    const body = await readJsonObject(request);
    if (!body) {
      return withState(
        state,
        'The request body must be JSON like {"move":"refuse","turn":0}.',
        400,
      );
    }
    const parsedTurn = parseTurn(body.turn);
    if (!parsedTurn.ok) {
      return withState(
        state,
        `turn must be the whole number in the state's turn field. The run is at turn ${state.turn}.`,
      );
    }

    // Only ask the agent when the move is really going to be applied.
    const rejection = checkMove(state, body.move, parsedTurn.turn);
    if (rejection !== null) return withState(state, rejection);
    const addressCheck = body.move === 'check_address' ? await checkAddress(state) : undefined;

    const outcome = applyMove(
      state,
      seedFor(state.run_id),
      body.move,
      parsedTurn.turn,
      addressCheck,
    );
    if (!(await store.put(outcome.state, state.turn))) {
      const current = (await store.get(state.run_id)) ?? state;
      return withState(
        current,
        `Another request changed this run first, so this move was not applied. The run is at turn ${current.turn}.`,
      );
    }
    return withState(outcome.state.done ? await settleMemo(outcome.state) : outcome.state);
  }

  async function retryMemo(request: Request, state: DojoState): Promise<Response> {
    if (!holdsPlayToken(request, state.run_id)) {
      return withState(state, 'Missing or wrong play token.', 401);
    }
    if (!state.result) return withState(state, 'The memo is written when the run is over.');
    if (state.result.memo_status === 'written') return withState(state);
    return withState(await settleMemo(state));
  }

  function index(): Response {
    return json(200, {
      game: 'HOLDBACK Scam Dojo',
      base_url: options.baseUrl,
      moves: MOVES,
      rules: RULES,
      endpoints: {
        start: 'POST /runs',
        state: 'GET /runs/{run_id}',
        move: 'POST /runs/{run_id}/moves',
        watch: 'GET /runs/{run_id}/watch',
        memo: 'POST /runs/{run_id}/memo',
      },
    });
  }

  async function route(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });

    const path = new URL(request.url).pathname;
    const notFound = () => json(404, { error: `No Dojo endpoint at ${request.method} ${path}.` });
    if (!path.startsWith(prefix)) return notFound();
    const [collection, runId, action, ...rest] = path
      .slice(prefix.length)
      .split('/')
      .filter(Boolean);
    const isGet = request.method === 'GET';
    const isPost = request.method === 'POST';

    if (collection === undefined) return isGet ? index() : notFound();
    if (collection !== 'runs' || rest.length > 0) return notFound();
    if (runId === undefined) return isPost ? start(request) : notFound();

    const state = RUN_ID.test(runId) ? await store.get(runId) : null;
    if (!state) return json(404, { error: `No run with id ${runId}. Start one with POST /runs.` });

    if (action === undefined && isGet) return withState(state);
    if (action === 'watch' && isGet) {
      return json(200, {
        ...state,
        error: null,
        rounds: revealRounds(state, seedFor(state.run_id)),
      });
    }
    if (action === 'moves' && isPost) return move(request, state);
    if (action === 'memo' && isPost) return retryMemo(request, state);
    return notFound();
  }

  return async (request) => {
    try {
      return await route(request);
    } catch (error) {
      console.error('dojo handler failed', error);
      return json(503, {
        error: 'The Dojo is temporarily unavailable. Read the run state and try again.',
      });
    }
  };
}
