import { CollectorUnavailable } from '../errors';
import { withTimeout } from '../lib/http';
import type { Collector, CollectorContext, CollectorOutcome } from './types';

/** Reasons are logged, and an upstream error can quote a URL: keep credentials out of them. */
function redact(reason: string): string {
  return reason.replace(/([?&][\w-]*(key|token|secret)[\w-]*=)[^&\s"']+/gi, '$1***').slice(0, 300);
}

/**
 * Runs one collector inside its time budget. Whatever goes wrong, the
 * result is an outcome, never an exception: a missing source must not stop
 * an assessment.
 *
 * A collector that misses its budget keeps running in the background, so
 * its answer is cached for the next assessment of the same recipient
 * (typically the periodic re-assessment of the pending hold).
 */
export async function runCollector(
  collector: Collector,
  context: CollectorContext,
): Promise<CollectorOutcome> {
  const started = Date.now();
  const work = collector.collect(context);
  try {
    const signals = await withTimeout(work, collector.timeoutMs);
    return { name: collector.name, available: true, signals, ms: Date.now() - started };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'timeout';
    if (timedOut) context.services.background.waitUntil(work.catch(() => undefined));
    const reason = redact(
      error instanceof CollectorUnavailable
        ? error.reason
        : error instanceof Error
          ? error.message
          : 'failed',
    );
    return {
      name: collector.name,
      available: false,
      signals: [],
      reason,
      ms: Date.now() - started,
    };
  }
}

export function runCollectors(
  collectors: Collector[],
  context: CollectorContext,
): Promise<CollectorOutcome[]> {
  return Promise.all(collectors.map((collector) => runCollector(collector, context)));
}
