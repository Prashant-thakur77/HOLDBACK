/**
 * Collector 4: Chainabuse reports. The free tier allows very few calls per
 * month, so there is one key, every answer is cached for two days, and a
 * monthly budget is tracked: once it is spent the source reports
 * "unavailable" instead of being called.
 */
import { numberVar } from '../env';
import { CollectorUnavailable } from '../errors';
import type { EvidenceCache } from '../lib/cache';
import { bytesToBase64, utf8 } from '../lib/encoding';
import { UpstreamError, requestJson } from '../lib/http';
import type { Signal } from '../signals';
import type { Collector } from './types';

const ENDPOINT = 'https://api.chainabuse.com/v0/reports';
export const CACHE_TTL_SECS = 48 * 3_600;
/** The free tier's documented allowance. */
export const DEFAULT_MONTHLY_BUDGET = 10;
/** Reports without a trusted or checked mark that together count as confirmed. */
export const CONFIRMED_MIN_REPORTS = 3;
const BUDGET_TTL_SECS = 40 * 86_400;

interface Report {
  id: string;
  createdAt?: string;
  trusted?: boolean;
  checked?: boolean;
  scamCategory?: string;
}

/** What is cached per address. */
export interface ReportSummary {
  count: number;
  /** Reports from a trusted contributor or reviewed by Chainabuse. */
  vetted: number;
  categories: string[];
  latest: string | null;
}

export function summarise(payload: unknown): ReportSummary {
  const body = payload as { reports?: Report[]; count?: number };
  const reports = Array.isArray(body.reports) ? body.reports : [];
  const dates = reports
    .map((report) => report.createdAt)
    .filter((date): date is string => typeof date === 'string')
    .sort();
  return {
    count: typeof body.count === 'number' ? body.count : reports.length,
    vetted: reports.filter((report) => report.trusted === true || report.checked === true).length,
    categories: [
      ...new Set(reports.map((report) => report.scamCategory).filter((c): c is string => !!c)),
    ].sort(),
    latest: dates[dates.length - 1] ?? null,
  };
}

/** Pure mapping from a summary to signals. */
export function reportSignals(summary: ReportSummary, address: string): Signal[] {
  const source = 'chainabuse' as const;
  const url = `https://www.chainabuse.com/address/${address}`;
  if (summary.count === 0) {
    return [
      { source, signal: 'no_reports', detail: 'Chainabuse has no reports for this address.' },
    ];
  }
  const kinds = summary.categories.length > 0 ? ` (${summary.categories.join(', ')})` : '';
  const date = summary.latest ?? undefined;
  if (summary.vetted > 0 || summary.count >= CONFIRMED_MIN_REPORTS) {
    return [
      {
        source,
        signal: 'confirmed_reports',
        detail: `Chainabuse lists ${summary.count} scam report(s) for this address${kinds}, ${summary.vetted} of them vetted.`,
        url,
        matched: address,
        date,
      },
    ];
  }
  return [
    {
      source,
      signal: 'unconfirmed_reports',
      value: summary.count,
      detail: `Chainabuse lists ${summary.count} unverified scam report(s) for this address${kinds}.`,
      url,
      matched: address,
      date,
    },
  ];
}

const monthKey = (now: Date) => now.toISOString().slice(0, 7);

/** Spends one call from this month's budget, or throws when none is left. */
async function spendBudget(cache: EvidenceCache, budget: number, now: Date): Promise<void> {
  const month = monthKey(now);
  const used = (await cache.get<{ used: number }>('chainabuse_budget', month))?.used ?? 0;
  if (used >= budget) throw new CollectorUnavailable('monthly Chainabuse quota is spent');
  await cache.set('chainabuse_budget', month, { used: used + 1 }, BUDGET_TTL_SECS);
}

export const chainabuseCollector: Collector = {
  name: 'chainabuse',
  timeoutMs: 6_000,
  cacheTtlSecs: CACHE_TTL_SECS,
  async collect({ services, subject, now }) {
    const { env, cache } = services;
    const apiKey = env.CHAINABUSE_API_KEY;
    if (!apiKey) throw new CollectorUnavailable('CHAINABUSE_API_KEY is not set');
    const address = subject.recipient;

    const cached = await cache.get<ReportSummary>('chainabuse', address);
    if (cached) return reportSignals(cached, address);

    const budget = numberVar(env.CHAINABUSE_MONTHLY_BUDGET, DEFAULT_MONTHLY_BUDGET);
    await spendBudget(cache, budget, now);
    try {
      const payload = await requestJson(
        `${ENDPOINT}?address=${encodeURIComponent(address)}&chain=SOL&perPage=50`,
        {
          timeoutMs: 5_000,
          headers: {
            accept: 'application/json',
            authorization: `Basic ${bytesToBase64(utf8(`${apiKey}:${apiKey}`))}`,
          },
        },
      );
      const summary = summarise(payload);
      await cache.set('chainabuse', address, summary, CACHE_TTL_SECS);
      return reportSignals(summary, address);
    } catch (error) {
      if (error instanceof UpstreamError && [402, 403, 429].includes(error.status)) {
        // The provider says the quota is gone: stop calling for this month.
        await cache.set('chainabuse_budget', monthKey(now), { used: budget }, BUDGET_TTL_SECS);
        throw new CollectorUnavailable('Chainabuse quota is spent');
      }
      throw error;
    }
  },
};
