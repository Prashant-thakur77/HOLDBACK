/**
 * The webhook's request handler, free of any runtime-specific API: the
 * database and the RPC node are passed in, so the same code runs in the Edge
 * runtime and in the Node test-suite.
 */
import { isAuthorized } from './auth.ts';
import { parseEvents } from './events.ts';
import { PayloadError, parseWebhookBody, type WebhookTransaction } from './payload.ts';
import { toIngestEvents, type IngestEvent } from './records.ts';
import type { LogFetcher } from './rpc.ts';
import type { Stablecoins } from './stablecoins.ts';

/**
 * What `ingest_hold_events` did with one row:
 * `applied` changed the mirror, `duplicate` was already there (a replay) and
 * `unknown_hold` refers to a hold whose creation has not been stored yet.
 */
export type IngestOutcome = 'applied' | 'duplicate' | 'unknown_hold';

export interface IngestResult {
  kind: IngestEvent['kind'];
  /** The hold PDA, or the signature for an instant transfer. */
  ref: string;
  outcome: IngestOutcome;
}

export interface HandlerDeps {
  /** `HELIUS_WEBHOOK_SECRET`. Requests are refused while it is unset. */
  secret: string | undefined;
  programId: string;
  stablecoins: Stablecoins;
  /** Applies all rows in one database transaction; results are in input order. */
  ingest: (events: IngestEvent[]) => Promise<IngestResult[]>;
  /** Looks up logs for payloads that carry none. Absent without an RPC URL. */
  fetchLogs?: LogFetcher;
}

/** A failure with the status and code the caller should see. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, code: string, message: string, extra: object = {}): Response {
  return json(status, { ok: false, error: { code, message }, ...extra });
}

/** Logs of a successful transaction, `[]` for a failed one, null when not yet known. */
async function logsOf(tx: WebhookTransaction, fetchLogs?: LogFetcher): Promise<string[] | null> {
  if (tx.failed) return [];
  if (tx.logs) return tx.logs;
  if (!fetchLogs) {
    throw new HttpError(
      500,
      'rpc_not_configured',
      'This payload has no log messages. Set HELIUS_RPC_URL or use a raw webhook.',
    );
  }
  try {
    const fetched = await fetchLogs(tx.signature);
    if (!fetched) return null;
    return fetched.failed ? [] : fetched.logs;
  } catch (cause) {
    console.error(`getTransaction failed for ${tx.signature}:`, cause);
    throw new HttpError(502, 'logs_unavailable', 'Could not fetch transaction logs.');
  }
}

async function handle(request: Request, deps: HandlerDeps): Promise<Response> {
  if (request.method !== 'POST') {
    throw new HttpError(405, 'method_not_allowed', 'Use POST.');
  }
  if (!deps.secret) {
    throw new HttpError(500, 'not_configured', 'HELIUS_WEBHOOK_SECRET is not set.');
  }
  if (!(await isAuthorized(request, deps.secret))) {
    throw new HttpError(401, 'unauthorized', 'Missing or wrong Authorization header.');
  }

  let transactions: WebhookTransaction[];
  try {
    transactions = parseWebhookBody(await request.json());
  } catch (cause) {
    const message = cause instanceof PayloadError ? cause.message : 'Body is not valid JSON.';
    throw new HttpError(400, 'invalid_payload', message);
  }

  const logs = await Promise.all(transactions.map((tx) => logsOf(tx, deps.fetchLogs)));
  const records: IngestEvent[] = [];
  const pendingSignatures: string[] = [];
  transactions.forEach((tx, i) => {
    const lines = logs[i];
    if (!lines) {
      pendingSignatures.push(tx.signature);
      return;
    }
    const events = parseEvents(lines, deps.programId);
    records.push(...toIngestEvents(tx.signature, events, deps.stablecoins));
  });

  let results: IngestResult[] = [];
  if (records.length > 0) {
    try {
      results = await deps.ingest(records);
    } catch (cause) {
      console.error('ingest failed:', cause);
      throw new HttpError(500, 'ingest_failed', 'Could not store the events.');
    }
  }

  const count = (outcome: IngestOutcome) =>
    results.filter((result) => result.outcome === outcome).length;
  const unknownHolds = [
    ...new Set(results.filter((r) => r.outcome === 'unknown_hold').map((r) => r.ref)),
  ];

  // Everything that could be stored has been. A settlement or extension that
  // overtook its hold's creation, or a transaction the RPC node has not seen
  // yet, is answered with 503 so that Helius delivers it again; the rows
  // already applied are skipped as duplicates on that retry.
  if (unknownHolds.length > 0 || pendingSignatures.length > 0) {
    return failure(503, 'retry_later', 'Some events could not be applied yet.', {
      applied: count('applied'),
      unknownHolds,
      pendingSignatures,
    });
  }

  return json(200, {
    ok: true,
    transactions: transactions.length,
    events: records.length,
    applied: count('applied'),
    duplicates: count('duplicate'),
  });
}

/** Builds the `fetch`-style handler served by the Edge function. */
export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handle(request, deps);
    } catch (cause) {
      if (cause instanceof HttpError) return failure(cause.status, cause.code, cause.message);
      console.error('unexpected failure:', cause);
      return failure(500, 'internal_error', 'Unexpected failure.');
    }
  };
}
