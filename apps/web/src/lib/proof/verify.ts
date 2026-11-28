/**
 * Re-checking the devnet proofs from a browser, with nothing but a public RPC
 * endpoint: no key, no server of ours in between.
 *
 * The rules are the ones the repository's terminal verifier (`make verify`)
 * applies, so the page and the command line cannot disagree:
 *
 * - a happy path passes when its transaction succeeded;
 * - an attack passes when its transaction failed with the recorded error;
 * - the deployed program passes when the sha256 of its on-chain bytes equals
 *   the hash of the reproducible build.
 *
 * Everything here is plain `fetch` and Web Crypto, so the Solana client
 * library is not needed to verify.
 */
import type { Proof } from './data';

/** The part of a `getTransaction` answer the checks read. */
export interface ObservedTransaction {
  meta: { err: unknown; logMessages?: string[] | null } | null;
}

export interface Verdict {
  pass: boolean;
  /** One plain sentence about what the chain shows. */
  detail: string;
}

/**
 * A plain token transfer into a deposit box: by design it never calls the
 * program, so "the program was invoked" is not asked of it.
 */
const PLAIN_TRANSFER_IDS = new Set(['H18']);

/**
 * The error a failed transaction shows: the program's own error name from the
 * logs; else the system program's "already in use"; else the raw error.
 */
export function observedError(logs: string[], err: unknown): string {
  const named = logs.join('\n').match(/Error Code: (\w+)/)?.[1];
  if (named) return named;
  if (logs.some((line) => /already in use/.test(line)))
    return 'AccountAlreadyInUse (system program)';
  return JSON.stringify(err);
}

/** Compares what the chain recorded for one proof with what the file says. */
export function judgeProof(
  proof: Pick<Proof, 'id' | 'kind' | 'error'>,
  transaction: ObservedTransaction | null,
  programId: string,
): Verdict {
  if (!transaction) return { pass: false, detail: 'The transaction was not found on-chain.' };
  const logs = transaction.meta?.logMessages ?? [];
  const err = transaction.meta?.err ?? null;
  const invoked =
    logs.some((line) => line.startsWith(`Program ${programId} invoke`)) ||
    PLAIN_TRANSFER_IDS.has(proof.id);
  if (!invoked) return { pass: false, detail: 'The transaction did not call the program.' };

  if (proof.kind === 'happy path') {
    return err === null
      ? { pass: true, detail: 'Executed on-chain.' }
      : { pass: false, detail: `Expected success, but it failed with ${JSON.stringify(err)}.` };
  }
  if (err === null) return { pass: false, detail: 'The attack executed.' };
  const seen = observedError(logs, err);
  return seen === proof.error
    ? { pass: true, detail: `Refused on-chain with ${seen}.` }
    : { pass: false, detail: `Refused with ${seen}; the record says ${proof.error ?? 'nothing'}.` };
}

// ---------- The deployed program ----------

/** ProgramData header: 4-byte tag, 8-byte slot, then an optional 32-byte upgrade authority. */
const HEADER_BYTES = 45;
const AUTHORITY_FLAG = 12;

export interface ProgramData {
  /** The upgrade authority's 32 bytes, or `null` when the program can no longer be upgraded. */
  authority: Uint8Array | null;
  /** The program itself: everything after the header, without the zero padding at the end. */
  body: Uint8Array;
}

export function readProgramData(data: Uint8Array): ProgramData {
  const authority =
    data.length >= HEADER_BYTES && data[AUTHORITY_FLAG] === 1
      ? data.subarray(AUTHORITY_FLAG + 1, HEADER_BYTES)
      : null;
  let end = data.length;
  while (end > HEADER_BYTES && data[end - 1] === 0) end--;
  return { authority, body: data.subarray(Math.min(HEADER_BYTES, data.length), end) };
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** sha256 of the program body, as hex. Uses Web Crypto, so it runs in any browser. */
export async function programHash(data: Uint8Array): Promise<string> {
  const { body } = readProgramData(data);
  // Copied into its own buffer: `body` is a view into the whole account.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(body));
  return toHex(new Uint8Array(digest));
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58, the way Solana prints addresses. */
export function toBase58(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index++) {
      carry += (digits[index] as number) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let text = '';
  // Each leading zero byte is one leading "1".
  for (const byte of bytes) {
    if (byte !== 0) break;
    text += BASE58[0];
  }
  for (let index = digits.length - 1; index >= 0; index--) text += BASE58[digits[index] as number];
  return text;
}

// ---------- Talking to the RPC endpoint ----------

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export interface RpcOptions {
  fetcher?: Fetcher;
  /** How many times a rate-limited request is tried again. */
  retries?: number;
  /** Waits before the next try; replaced in tests so they do not sleep. */
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How long to wait before trying again: what the endpoint asks for, else a growing pause. */
export function retryDelay(response: Pick<Response, 'headers'>, attempt: number): number {
  const asked = Number(response.headers.get('retry-after'));
  if (Number.isFinite(asked) && asked > 0) return Math.min(asked * 1000, 15_000);
  return Math.min(1_000 * (attempt + 1), 6_000);
}

/**
 * One JSON-RPC call. Public endpoints answer 429 when asked too fast; those
 * answers are retried with a growing pause instead of being read as a result.
 */
export async function rpcCall<T>(
  url: string,
  method: string,
  params: unknown[],
  options: RpcOptions = {},
): Promise<T> {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const retries = options.retries ?? 8;
  const wait = options.wait ?? sleep;
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (response.status === 429 && attempt < retries) {
      await wait(retryDelay(response, attempt));
      continue;
    }
    if (!response.ok) throw new Error(`The RPC endpoint answered ${response.status}.`);
    const body = (await response.json()) as {
      result?: T;
      error?: { code: number; message: string };
    };
    if (body.error?.code === 429 && attempt < retries) {
      await wait(retryDelay(response, attempt));
      continue;
    }
    if (body.error) throw new Error(body.error.message);
    return body.result as T;
  }
}

export function fetchTransaction(
  url: string,
  signature: string,
  options?: RpcOptions,
): Promise<ObservedTransaction | null> {
  return rpcCall<ObservedTransaction | null>(
    url,
    'getTransaction',
    [signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
    options,
  );
}

/** The raw bytes of an account, or `null` when it does not exist. */
export async function fetchAccountBytes(
  url: string,
  address: string,
  options?: RpcOptions,
): Promise<Uint8Array | null> {
  const result = await rpcCall<{ value: { data: [string, string] } | null }>(
    url,
    'getAccountInfo',
    [address, { encoding: 'base64', commitment: 'confirmed' }],
    options,
  );
  const encoded = result.value?.data[0];
  if (encoded === undefined) return null;
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Runs `work` over every item with at most `limit` running at once, pausing
 * `pauseMs` after each one so a public endpoint is not hammered.
 */
export async function runLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
  pauseMs = 0,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await work(item);
      if (pauseMs > 0) await sleep(pauseMs);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}
