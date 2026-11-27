/**
 * Writes the results table and the negative-result paragraph into README.md,
 * between `<!-- results:start -->` and `<!-- results:end -->`.
 *
 * Every figure is read from `eval/results.json`; nothing is computed or typed
 * here. Running it twice changes nothing, which is what CI checks. Without the
 * markers the README is left alone and the script exits 0 with a notice.
 *
 *   npm run readme:numbers        (from the repository root)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { format, resolveConfig } from 'prettier';

export const START = '<!-- results:start -->';
export const END = '<!-- results:end -->';

interface Proportion {
  successes: number;
  n: number;
  value: number | null;
  ci95_low: number | null;
  ci95_high: number | null;
}

interface ReplayRow {
  delay: string;
  payments: number;
  payments_reclaimable: number;
  share_of_payments: number | null;
  share_of_value: number | null;
}

interface SplitMetrics {
  recall: Proportion;
  false_positive_rate: Proportion;
  precision: Proportion;
  independent_recall?: Proportion;
  replay?: { payments: number; amounts_stated_by_source: number; table: ReplayRow[] };
}

interface LatencySummary {
  n: number;
  p50_ms: number | null;
  p95_ms: number | null;
}

/** The parts of `eval/results.json` this script reads. */
export interface Results {
  generated_at: string;
  git: { commit: string | null };
  config: { cutoff_date: string; assumed_amount_usd: number };
  environment: {
    guardian: { collectors_unavailable_in_every_assessment: string[] } | null;
    dataset_sources_unavailable: string[] | null;
  };
  baseline: { splits: Record<string, SplitMetrics> } | null;
  holdback: {
    splits: Record<string, SplitMetrics>;
    time_to_verdict: { client_ms: { n: number; median_ms: number | null } };
  } | null;
  negative_result: {
    n: number;
    caught: Proportion;
    windows_secs: number[];
    by_category: Record<string, { caught: Proportion }>;
    replay: ReplayRow[];
  } | null;
  latency: {
    assess?: { cold?: LatencySummary; warm?: LatencySummary };
    chain?: {
      available: boolean;
      reason?: string;
      create_hold?: LatencySummary;
      reclaim?: LatencySummary;
    };
  } | null;
  program_invariants: {
    invariant_cases: number;
    instructions_executed: number;
    violations: number;
  } | null;
}

const NOT_RUN = 'not run';
const number = (value: number) => value.toLocaleString('en-US');
const percent = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const millis = (value: number | null) =>
  value === null ? 'n/a' : `${number(Math.round(value))} ms`;

/** `k/n (x%, 95% CI a to b)`; an empty set is named as such, never shown as a rate. */
function proportion(p: Proportion | undefined): string {
  if (!p) return NOT_RUN;
  if (p.n === 0) return 'no rows (n = 0)';
  return `${p.successes}/${p.n} (${percent(p.value)}, 95% CI ${percent(p.ci95_low)} to ${percent(p.ci95_high)})`;
}

function latency(summary: LatencySummary | undefined): string {
  return summary
    ? `p50 ${millis(summary.p50_ms)}, p95 ${millis(summary.p95_ms)} (n = ${summary.n})`
    : NOT_RUN;
}

function minutes(seconds: number): string {
  return seconds % 3600 === 0 ? `${seconds / 3600} h` : `${Math.round(seconds / 60)} min`;
}

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

function resultsTable(results: Results): string {
  const baseline = results.baseline?.splits.heldout;
  const holdback = results.holdback?.splits.heldout;
  const rows: string[][] = [
    [
      'Recall on held-out scam addresses',
      proportion(baseline?.recall),
      proportion(holdback?.recall),
    ],
    [
      // The scam labels come from public lists the blocklist collector also reads, so a
      // hit there only repeats the label. This row counts evidence from every other source.
      'Recall without the label’s own list (independent evidence)',
      'n/a',
      proportion(holdback?.independent_recall),
    ],
    [
      'False-positive rate on legit addresses',
      proportion(baseline?.false_positive_rate),
      proportion(holdback?.false_positive_rate),
    ],
    ['Precision', proportion(baseline?.precision), proportion(holdback?.precision)],
  ];
  // A blocklist wallet stops the payments it flags; every other one is a plain transfer.
  const blocked = baseline
    ? `${percent(baseline.recall.value)} blocked (${baseline.recall.successes}/${baseline.recall.n}); the rest is a plain transfer, 0%`
    : NOT_RUN;
  for (const row of holdback?.replay?.table ?? []) {
    rows.push([
      `Scam value protected, sender reacts after ${row.delay}`,
      blocked,
      `${percent(row.share_of_value)} reclaimable (${row.payments_reclaimable}/${row.payments} payments)`,
    ]);
  }
  const verdict = results.holdback?.time_to_verdict.client_ms;
  rows.push([
    'Median time to verdict',
    'n/a',
    verdict ? `${millis(verdict.median_ms)} (n = ${verdict.n})` : NOT_RUN,
  ]);
  rows.push(['`/v1/assess`, first request', 'n/a', latency(results.latency?.assess?.cold)]);
  rows.push(['`/v1/assess`, repeat request', 'n/a', latency(results.latency?.assess?.warm)]);
  const chain = results.latency?.chain;
  const onChain = (summary: LatencySummary | undefined) =>
    chain?.available ? latency(summary) : `${NOT_RUN}${chain?.reason ? `: ${chain.reason}` : ''}`;
  rows.push(['`create_hold` to confirmed, devnet', 'n/a', onChain(chain?.create_hold)]);
  rows.push(['`reclaim` to confirmed, devnet', 'n/a', onChain(chain?.reclaim)]);
  return table(['Metric', 'Static blocklist', 'HOLDBACK'], rows);
}

function limits(results: Results): string {
  const missing = results.environment.guardian?.collectors_unavailable_in_every_assessment ?? [];
  const sources = results.environment.dataset_sources_unavailable ?? [];
  const parts: string[] = [];
  const independent = results.holdback?.splits.heldout?.independent_recall;
  if (independent && independent.n > 0) {
    parts.push(
      `Every scam label comes from a public list that the \`blocklist\` collector also reads, so recall above repeats the label; without that list the Guardian caught ${independent.successes} of ${independent.n}.`,
    );
  }
  if (missing.length > 0) {
    parts.push(
      `In this run these evidence collectors were unavailable for every assessment: ${missing.map((name) => `\`${name}\``).join(', ')}.`,
    );
  }
  if (sources.length > 0) {
    parts.push(
      `Dataset sources that could not be used: ${sources.map((name) => `\`${name}\``).join(', ')}.`,
    );
  }
  parts.push(
    'The numbers describe that configuration and nothing more; [`eval/RESULTS.md`](eval/RESULTS.md) lists every limit and the full tables.',
  );
  return parts.join(' ');
}

function negativeResult(results: Results): string {
  const negative = results.negative_result;
  if (!negative) return '**Where it fails.** The fresh-wallet case has not been run.';
  const windows = negative.windows_secs.map(minutes).join(', ');
  const replay = negative.replay
    .map(
      (row) =>
        `${row.payments_reclaimable}/${row.payments} (${percent(row.share_of_payments)}) after ${row.delay}`,
    )
    .join(', ');
  return [
    `**Where it fails.** A wallet created less than a day ago, with no reports and little or no history, gives the Guardian nothing to find. Of ${negative.n} such wallets (new mainnet wallets and never-used keypairs, none of them a known scam) it rated ${proportion(negative.caught)} as suspicious or worse.`,
    `What still helps is the default window: every one of them got ${windows}, so a payment to them could still be undone for ${replay}.`,
    'The gap that remains: a victim who notices after the default window has closed gets nothing back, exactly as with a plain transfer.',
  ].join(' ');
}

function invariants(results: Results): string {
  const data = results.program_invariants;
  if (!data) return '';
  return `Program property test: ${number(data.invariant_cases)} random cases, ${number(data.instructions_executed)} instructions, ${number(data.violations)} invariant violations.`;
}

type TierCounts = Record<string, number>;

const TIER_ORDER = ['TRUSTED', 'UNKNOWN', 'SUSPICIOUS', 'FLAGGED', 'SANCTIONED'];

function addTiers(total: TierCounts, more: TierCounts | undefined): void {
  for (const [tier, count] of Object.entries(more ?? {})) total[tier] = (total[tier] ?? 0) + count;
}

const round = (value: number) => Math.round(value);

/** Mermaid charts drawn from the same results as the table; GitHub renders them. */
function charts(results: Results): string {
  const blocks: string[] = [];
  const raw = results as unknown as {
    holdback?: {
      legit?: { tiers?: TierCounts };
      splits?: Record<string, { tiers?: TierCounts }>;
    };
    negative_result?: { by_category?: Record<string, { tiers?: TierCounts }> };
  };

  const latency: [string, LatencySummary | undefined][] = [
    ['assess, first', results.latency?.assess?.cold],
    ['assess, repeat', results.latency?.assess?.warm],
    [
      'create_hold',
      results.latency?.chain?.available ? results.latency.chain.create_hold : undefined,
    ],
    ['reclaim', results.latency?.chain?.available ? results.latency.chain.reclaim : undefined],
  ];
  const measured = latency.filter(
    (entry): entry is [string, LatencySummary] =>
      entry[1]?.p50_ms != null && entry[1]?.p95_ms != null,
  );
  if (measured.length > 0) {
    const top = Math.ceil(Math.max(...measured.map(([, s]) => s.p95_ms ?? 0)) / 500) * 500;
    blocks.push(
      [
        '```mermaid',
        'xychart-beta',
        '  title "Latency in ms (bars: median, line: 95th percentile)"',
        `  x-axis [${measured.map(([name]) => `"${name}"`).join(', ')}]`,
        `  y-axis "ms" 0 --> ${top}`,
        `  bar [${measured.map(([, s]) => round(s.p50_ms ?? 0)).join(', ')}]`,
        `  line [${measured.map(([, s]) => round(s.p95_ms ?? 0)).join(', ')}]`,
        '```',
      ].join('\n'),
    );
  }

  const replay = results.holdback?.splits.heldout?.replay?.table ?? [];
  if (replay.length > 0) {
    blocks.push(
      [
        '```mermaid',
        'xychart-beta',
        '  title "Held-out scam value still reclaimable, by how long the sender takes to react (%)"',
        `  x-axis [${replay.map((row) => `"${row.delay}"`).join(', ')}]`,
        '  y-axis "% of value" 0 --> 100',
        `  bar [${replay.map((row) => round((row.share_of_value ?? 0) * 100)).join(', ')}]`,
        `  line [${replay.map(() => 0).join(', ')}]`,
        '```',
      ].join('\n'),
      'Bars: HOLDBACK. Line: a plain transfer, which cannot be reclaimed at any delay.',
    );
  }

  const tiers: TierCounts = {};
  addTiers(tiers, raw.holdback?.legit?.tiers);
  for (const split of Object.values(raw.holdback?.splits ?? {})) addTiers(tiers, split.tiers);
  for (const category of Object.values(raw.negative_result?.by_category ?? {})) {
    addTiers(tiers, category.tiers);
  }
  const assigned = TIER_ORDER.filter((tier) => (tiers[tier] ?? 0) > 0);
  if (assigned.length > 0) {
    blocks.push(
      [
        '```mermaid',
        'pie showData',
        '  title Tiers the risk agent assigned in this run',
        ...assigned.map((tier) => `  "${tier}" : ${tiers[tier]}`),
        '```',
      ].join('\n'),
    );
  }
  return blocks.join('\n\n');
}

/** The markdown that goes between the markers, formatted the way the repo's prettier would. */
export async function renderBlock(results: Results, root = process.cwd()): Promise<string> {
  const commit = results.git.commit ? ` at commit \`${results.git.commit.slice(0, 7)}\`` : '';
  const body = [
    `Run of ${results.generated_at.slice(0, 10)}${commit}. Held-out means first published on or after ${results.config.cutoff_date}.`,
    resultsTable(results),
    charts(results),
    limits(results),
    negativeResult(results),
    invariants(results),
  ]
    .filter((part) => part !== '')
    .join('\n\n');
  const options = (await resolveConfig(join(root, 'README.md'))) ?? {};
  return (await format(body, { ...options, parser: 'markdown' })).trim();
}

/** `readme` with the block between the markers replaced, or `null` when a marker is missing. */
export function replaceBlock(readme: string, block: string): string | null {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) return null;
  return `${readme.slice(0, start + START.length)}\n\n${block}\n\n${readme.slice(end)}`;
}

export async function main(root = process.cwd()): Promise<number> {
  const readmePath = join(root, 'README.md');
  const resultsPath = join(root, 'eval', 'results.json');
  if (!existsSync(resultsPath)) {
    console.log('eval/results.json not found: README.md left unchanged. Run `make eval` first.');
    return 0;
  }
  const readme = readFileSync(readmePath, 'utf8');
  const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as Results;
  const updated = replaceBlock(readme, await renderBlock(results, root));
  if (updated === null) {
    console.log(`Markers ${START} and ${END} not found: README.md left unchanged.`);
    return 0;
  }
  if (updated !== readme) writeFileSync(readmePath, updated);
  console.log(updated === readme ? 'README.md is up to date.' : 'README.md results block updated.');
  return 0;
}

if (basename(process.argv[1] ?? '') === 'readme_numbers.ts') {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'failed');
      process.exit(1);
    },
  );
}
