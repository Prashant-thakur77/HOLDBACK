/** Latency summaries. Percentiles use linear interpolation, the same rule as `eval/metrics.py`. */

export interface LatencySummary {
  n: number;
  p50_ms: number | null;
  p95_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
}

export function percentile(values: number[], q: number): number | null {
  if (q < 0 || q > 100) throw new Error('q must be within 0..100');
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const rank = ((ordered.length - 1) * q) / 100;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return ordered[low]! + (ordered[high]! - ordered[low]!) * (rank - low);
}

const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);

export function summarise(values: number[]): LatencySummary {
  return {
    n: values.length,
    p50_ms: round(percentile(values, 50)),
    p95_ms: round(percentile(values, 95)),
    min_ms: values.length ? round(Math.min(...values)) : null,
    max_ms: values.length ? round(Math.max(...values)) : null,
  };
}
