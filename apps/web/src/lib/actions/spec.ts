/**
 * The HTTP side of the Solana Actions specification: the headers every
 * response must carry (including errors and the `OPTIONS` preflight) and the
 * error body shape. The response types come from `@solana/actions-spec`.
 *
 * `Access-Control-Allow-Origin: *` is correct here and only here: Action
 * endpoints and `actions.json` are public by design, because any Blink
 * client on any origin must be able to read them.
 */
import type { ActionError } from '@solana/actions-spec';

import type { Cluster } from '../env';
import { CHAIN_IDS } from '../cluster';

/** The spec version these handlers implement (the `@solana/actions-spec` release line). */
export const ACTION_VERSION = '2.4';

export function actionHeaders(cluster: Cluster): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids',
    'Access-Control-Expose-Headers': 'X-Action-Version, X-Blockchain-Ids',
    'X-Action-Version': ACTION_VERSION,
    'X-Blockchain-Ids': CHAIN_IDS[cluster],
    'Content-Type': 'application/json',
    // A verdict can change at any moment; clients must not reuse an old one.
    'Cache-Control': 'no-store',
  };
}

export function actionJson(body: unknown, cluster: Cluster, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: actionHeaders(cluster) });
}

/** A failed Action request. `status` is the HTTP status the client sees. */
export class ActionFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ActionFailure';
  }
}

export function actionError(failure: ActionFailure, cluster: Cluster): Response {
  const body: ActionError = { message: failure.message };
  return actionJson(body, cluster, failure.status);
}

/** The CORS preflight: no body, same headers. */
export function actionPreflight(cluster: Cluster): Response {
  return new Response(null, { status: 204, headers: actionHeaders(cluster) });
}
