/**
 * `/v1/assess` latency, measured from the client over HTTP.
 *
 * Cold: each request names a recipient the service has never seen, so no
 * collector answer is cached. Warm: the same recipients again, straight
 * after, so cacheable collectors answer from memory. The recipients are
 * freshly generated addresses with no history; a recipient with a long
 * history costs the history collector more when it is configured.
 */
import { Keypair } from '@solana/web3.js';
import { GuardianClient, type AssessResponse } from '@holdback/sdk';

import { summarise, type LatencySummary } from './stats';

/** 1 SOL in lamports; the amount does not change which collectors run. */
const AMOUNT = '1000000000';

export interface AssessBench {
  requests_per_phase: number;
  pause_between_requests_ms: number;
  cold: LatencySummary;
  warm: LatencySummary;
  /** Collectors that did not answer, with the number of requests they missed. */
  unavailable_collectors: Record<string, number>;
  failed_requests: number;
  note: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `pauseMs` is waited between requests and is not part of any timing. Without
 * it a burst of assessments trips the rate limit of a public RPC endpoint,
 * and the retries would be measured instead of the service.
 */
export async function benchAssess(
  baseUrl: string,
  requests: number,
  pauseMs: number,
): Promise<AssessBench> {
  const client = new GuardianClient({ baseUrl });
  const sender = Keypair.generate().publicKey.toBase58();
  const recipients = Array.from({ length: requests }, () =>
    Keypair.generate().publicKey.toBase58(),
  );
  const unavailable: Record<string, number> = {};
  let failed = 0;

  const phase = async (): Promise<number[]> => {
    const timings: number[] = [];
    for (const recipient of recipients) {
      const started = performance.now();
      let response: AssessResponse;
      try {
        response = await client.assess({
          sender,
          recipient,
          mint: null,
          amount: AMOUNT,
          lang: 'en',
        });
      } catch {
        failed += 1;
        continue;
      }
      timings.push(performance.now() - started);
      await sleep(pauseMs);
      for (const name of response.unavailable) unavailable[name] = (unavailable[name] ?? 0) + 1;
    }
    return timings;
  };

  const cold = await phase();
  const warm = await phase();
  return {
    requests_per_phase: requests,
    pause_between_requests_ms: pauseMs,
    cold: summarise(cold),
    warm: summarise(warm),
    unavailable_collectors: Object.fromEntries(Object.entries(unavailable).sort()),
    failed_requests: failed,
    note: 'sequential requests over HTTP; recipients are new addresses without history',
  };
}
