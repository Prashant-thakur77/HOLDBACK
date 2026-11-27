/** Test-only helpers: a routed `fetch` replacement and JSON-RPC answers. Nothing here ships. */
import { vi } from 'vitest';

export type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

export interface FetchMock {
  /** Every URL requested, in order. */
  calls: string[];
  restore(): void;
}

/**
 * Replaces the global `fetch`. Each request goes to the handler whose key
 * is the URL's host; a host with no handler fails like an unreachable
 * network.
 */
export function mockFetch(routes: Record<string, Handler>): FetchMock {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    calls.push(url.toString());
    const handler = routes[url.host];
    if (!handler) throw new TypeError('fetch failed');
    return handler(url, init);
  });
  return { calls, restore: () => vi.unstubAllGlobals() };
}

export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A Solana JSON-RPC endpoint answering each method from `results`. */
export function rpcHandler(results: Record<string, (params: unknown[]) => unknown>): Handler {
  return async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id: unknown;
      method: string;
      params?: unknown[];
    };
    const answer = results[request.method];
    if (!answer) {
      return json({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'no method' },
      });
    }
    return json({ jsonrpc: '2.0', id: request.id, result: answer(request.params ?? []) });
  };
}

/** An RPC on which no account exists. */
export const emptyCluster = rpcHandler({
  getAccountInfo: () => ({ context: { slot: 1 }, value: null }),
  getProgramAccounts: () => [],
});
