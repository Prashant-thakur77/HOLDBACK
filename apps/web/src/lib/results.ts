/**
 * Evaluation data for the results page.
 *
 * `next.config.ts` reads `eval/program_invariants.json` and, when it exists,
 * `eval/results.json` at build time and compiles their text into the server
 * bundle. Nothing here is typed in by hand: a missing or unreadable file
 * yields `null`, and the page then says so instead of showing a number.
 */
import { z } from 'zod';

const invariantsSchema = z.object({
  invariant_cases: z.number().int().nonnegative(),
  instructions_executed: z.number().int().nonnegative(),
  holds_opened: z.number().int().nonnegative().optional(),
  violations: z.number().int().nonnegative(),
});

export interface ProgramInvariants {
  cases: number;
  instructions: number;
  holdsOpened: number | null;
  violations: number;
}

export function parseInvariants(text: string | undefined): ProgramInvariants | null {
  if (!text) return null;
  try {
    const parsed = invariantsSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    return {
      cases: parsed.data.invariant_cases,
      instructions: parsed.data.instructions_executed,
      holdsOpened: parsed.data.holds_opened ?? null,
      violations: parsed.data.violations,
    };
  } catch {
    return null;
  }
}

/** One printed line of the evaluation: where the value sits in the file, and the value. */
export interface ResultRow {
  /** Dotted path in `results.json`, e.g. `test.recall`. */
  path: string;
  value: string;
}

const proportion = z.object({ successes: z.number(), n: z.number(), value: z.number().nullable() });

function formatLeaf(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString('en-US') : String(+value.toFixed(4));
  }
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  if (value === null) return 'not available';
  return null;
}

/**
 * Flattens the results file into rows without assuming its exact shape, so
 * the page keeps printing whatever the evaluation writes. A proportion
 * (`{successes, n, value}`) is printed as one row with its counts, because a
 * rate without its sample size is not a result.
 */
export function flattenResults(node: unknown, prefix = '', rows: ResultRow[] = []): ResultRow[] {
  const leaf = formatLeaf(node);
  if (leaf !== null) {
    rows.push({ path: prefix || 'value', value: leaf });
    return rows;
  }
  const ratio = proportion.safeParse(node);
  if (ratio.success) {
    const { successes, n, value } = ratio.data;
    const rate = value === null ? 'not available' : `${(value * 100).toFixed(1)}%`;
    rows.push({ path: prefix, value: `${rate} (${successes} of ${n})` });
    return rows;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => flattenResults(item, `${prefix}[${index}]`, rows));
    return rows;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      flattenResults(value, prefix ? `${prefix}.${key}` : key, rows);
    }
  }
  return rows;
}

export function parseResults(text: string | undefined): ResultRow[] | null {
  if (!text) return null;
  try {
    const rows = flattenResults(JSON.parse(text));
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

/** The property-test counts compiled into this build, or `null`. */
export function programInvariants(): ProgramInvariants | null {
  return parseInvariants(process.env.EVAL_PROGRAM_INVARIANTS);
}

/** The evaluation rows compiled into this build, or `null` when `make eval` has not been run. */
export function evalResults(): ResultRow[] | null {
  return parseResults(process.env.EVAL_RESULTS);
}

// ---------- A reading of the evaluation for the results page ----------

/** A rate with its sample, and the 95% interval when the file gives one. */
export interface Rate {
  successes: number;
  n: number;
  value: number | null;
  low: number | null;
  high: number | null;
}

export interface SplitScores {
  name: string;
  holdback: { recall: Rate | null; falsePositive: Rate | null; precision: Rate | null };
  baseline: { recall: Rate | null; falsePositive: Rate | null; precision: Rate | null };
}

export interface ReplayRow {
  delay: string;
  payments: number;
  reclaimable: number;
  /** Share of value a plain transfer would still let the sender recover. */
  plainTransferShare: number | null;
}

export interface Timing {
  n: number | null;
  median: number | null;
  p95: number | null;
}

export interface Evaluation {
  generatedAt: string | null;
  commit: string | null;
  uncommittedChanges: boolean;
  assessments: number | null;
  policyVersions: string[];
  unavailableCollectors: string[];
  answeringCollectors: string[];
  datasetRows: number | null;
  rowsByLabel: Record<string, number>;
  detectionRule: string | null;
  baselineMethod: string | null;
  splits: SplitScores[];
  negative: { n: number | null; caught: Rate | null; windowsSecs: number[] } | null;
  replay: { label: string; rows: ReplayRow[] }[];
  assumedAmountUsd: number | null;
  verdict: Timing | null;
  chain: { host: string | null; createHold: Timing; reclaim: Timing } | null;
  limitations: string[];
}

function dig(node: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      current && typeof current === 'object'
        ? (current as Record<string, unknown>)[key]
        : undefined,
    node,
  );
}

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function asRate(value: unknown): Rate | null {
  const successes = asNumber(dig(value, 'successes'));
  const n = asNumber(dig(value, 'n'));
  if (successes === null || n === null) return null;
  return {
    successes,
    n,
    value: asNumber(dig(value, 'value')),
    low: asNumber(dig(value, 'ci95_low')),
    high: asNumber(dig(value, 'ci95_high')),
  };
}

function asCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, count]) => {
      const number = asNumber(count);
      return number === null ? [] : [[key, number]];
    }),
  );
}

function asReplay(value: unknown): ReplayRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const delay = asString(dig(row, 'delay'));
    const payments = asNumber(dig(row, 'payments'));
    const reclaimable = asNumber(dig(row, 'payments_reclaimable'));
    if (delay === null || payments === null || reclaimable === null) return [];
    return [
      {
        delay,
        payments,
        reclaimable,
        plainTransferShare: asNumber(dig(row, 'plain_transfer_share_of_value')),
      },
    ];
  });
}

function scores(node: unknown): SplitScores['holdback'] {
  return {
    recall: asRate(dig(node, 'recall')),
    falsePositive: asRate(dig(node, 'false_positive_rate')),
    precision: asRate(dig(node, 'precision')),
  };
}

function timing(node: unknown, medianKey: string): Timing {
  return {
    n: asNumber(dig(node, 'n')),
    median: asNumber(dig(node, medianKey)),
    p95: asNumber(dig(node, 'p95_ms')),
  };
}

/**
 * Picks the parts of `results.json` the page sets in type. Every field is
 * optional: a part the evaluation did not write is simply not shown, and the
 * full file is always printed underneath as rows.
 */
export function readEvaluation(text: string | undefined): Evaluation | null {
  if (!text) return null;
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  if (!file || typeof file !== 'object' || Object.keys(file).length === 0) return null;

  const splitsNode = dig(file, 'holdback', 'splits');
  const splitNames = splitsNode && typeof splitsNode === 'object' ? Object.keys(splitsNode) : [];
  const splits = splitNames
    .map((name) => ({
      name,
      holdback: scores(dig(file, 'holdback', 'splits', name)),
      baseline: scores(dig(file, 'baseline', 'splits', name)),
    }))
    // A split with no scam rows has no detection rate to report.
    .filter((split) => (split.holdback.recall?.n ?? 0) > 0);

  const replay = [
    ...splits.map((split) => ({
      label: `Scam payments, ${split.name} set`,
      rows: asReplay(dig(file, 'holdback', 'splits', split.name, 'replay', 'table')),
    })),
    { label: 'Payments to fresh wallets', rows: asReplay(dig(file, 'negative_result', 'replay')) },
  ].filter((table) => table.rows.length > 0);

  const negative = dig(file, 'negative_result');
  const chain = dig(file, 'latency', 'chain');
  const verdict = dig(file, 'holdback', 'time_to_verdict', 'client_ms');
  const windows = dig(negative, 'windows_secs');

  return {
    generatedAt: asString(dig(file, 'generated_at')),
    commit: asString(dig(file, 'git', 'commit')),
    uncommittedChanges: dig(file, 'git', 'uncommitted_changes') === true,
    assessments: asNumber(dig(file, 'environment', 'guardian', 'assessments')),
    policyVersions: asStrings(dig(file, 'environment', 'guardian', 'policy_versions')),
    unavailableCollectors: asStrings(
      dig(file, 'environment', 'guardian', 'collectors_unavailable_in_every_assessment'),
    ),
    answeringCollectors: asStrings(
      dig(file, 'environment', 'guardian', 'collectors_answering_in_every_assessment'),
    ),
    datasetRows: asNumber(dig(file, 'dataset', 'rows')),
    rowsByLabel: asCounts(dig(file, 'dataset', 'rows_by_label')),
    detectionRule: asString(dig(file, 'holdback', 'detection_rule')),
    baselineMethod: asString(dig(file, 'baseline', 'method')),
    splits,
    negative: negative
      ? {
          n: asNumber(dig(negative, 'n')),
          caught: asRate(dig(negative, 'caught')),
          windowsSecs: Array.isArray(windows)
            ? windows.filter((item): item is number => typeof item === 'number')
            : [],
        }
      : null,
    replay,
    assumedAmountUsd:
      dig(file, 'config', 'assumed_amount_is_an_assumption') === true
        ? asNumber(dig(file, 'config', 'assumed_amount_usd'))
        : null,
    verdict: verdict ? timing(verdict, 'median_ms') : null,
    chain:
      chain && dig(chain, 'available') === true
        ? {
            host: asString(dig(chain, 'cluster_rpc_host')),
            createHold: timing(dig(chain, 'create_hold'), 'p50_ms'),
            reclaim: timing(dig(chain, 'reclaim'), 'p50_ms'),
          }
        : null,
    limitations: asStrings(dig(file, 'limitations')),
  };
}

/** The curated reading of the evaluation compiled into this build, or `null`. */
export function evaluation(): Evaluation | null {
  return readEvaluation(process.env.EVAL_RESULTS);
}
