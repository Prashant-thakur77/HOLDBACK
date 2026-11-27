/**
 * Fetches a transaction's logs over JSON-RPC, for webhook payloads that do
 * not carry them (the enhanced shape).
 */

export interface TransactionLogs {
  failed: boolean;
  logs: string[];
}

export type LogFetcher = (signature: string) => Promise<TransactionLogs | null>;

interface GetTransactionResponse {
  result?: { meta?: { err?: unknown; logMessages?: string[] | null } | null } | null;
  error?: { message?: string };
}

/** Stay well inside the time Helius waits for an answer before it retries. */
const RPC_TIMEOUT_MS = 4_000;

/**
 * Builds a fetcher bound to one RPC endpoint. It resolves to null when the
 * node does not know the transaction yet, which the caller treats as "ask me
 * again", and throws on transport or RPC errors.
 */
export function createLogFetcher(rpcUrl: string, fetcher: typeof fetch = fetch): LogFetcher {
  return async (signature) => {
    const response = await fetcher(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [
          signature,
          { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
        ],
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`RPC answered with status ${response.status}`);

    const payload = (await response.json()) as GetTransactionResponse;
    if (payload.error) throw new Error(`RPC error: ${payload.error.message ?? 'unknown'}`);
    const meta = payload.result?.meta;
    if (!meta) return null;
    return { failed: meta.err !== null && meta.err !== undefined, logs: meta.logMessages ?? [] };
  };
}
