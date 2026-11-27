/**
 * Prints the README's policy and collector tables from the code, so the
 * documented weights, time budgets and cache times are the ones that run.
 * A test fails when the README and this output differ.
 *
 *   npx tsx scripts/readme-tables.ts
 */
import { pathToFileURL } from 'node:url';
import { TIER_NAMES, Tier, WINDOW_SECS_BY_TIER } from '@holdback/sdk';

import { ALL_COLLECTORS } from '../src/collectors';
import * as baseline from '../src/collectors/baseline';
import * as chainabuse from '../src/collectors/chainabuse';
import * as context from '../src/collectors/context';
import * as helius from '../src/collectors/helius';
import * as h from '../src/collectors/heuristics';
import * as lookalike from '../src/collectors/lookalike';
import * as onchain from '../src/collectors/onchain';
import * as web from '../src/collectors/web';
import { MAX_QUOTE_WORDS } from '../src/collectors/web-extract';
import {
  GROUP_CAPS,
  HISTORY_TRUST_WINDOW_SECS,
  RULES,
  SUSPICIOUS_SCORE,
  TRUSTED_HISTORY_MIN_RELEASES,
  type Rule,
} from '../src/policy';

const EFFECTS: Record<NonNullable<Rule['effect']>, string> = {
  sanctioned: 'SANCTIONED',
  confirmed_scam: 'FLAGGED (confirmed scam report)',
  trust_account: 'TRUSTED',
  trusted_history: `TRUSTED from ${TRUSTED_HISTORY_MIN_RELEASES} completed payments, if no flags and score below ${SUSPICIOUS_SCORE}`,
};

function points(rule: Rule): string {
  const sign = rule.points > 0 ? '+' : '';
  if (rule.perUnit) return `${sign}${rule.points} each, at most ${rule.cap}`;
  return `${sign}${rule.points}`;
}

export function policyTable(): string {
  const rows = Object.entries(RULES).map(
    ([id, rule]) =>
      `| \`${id}\` | ${rule.title} | ${points(rule)} | ${rule.effect ? EFFECTS[rule.effect] : ''} |`,
  );
  return ['| Rule | Meaning | Points | Sets tier |', '|---|---|---|---|', ...rows].join('\n');
}

export function tierTable(): string {
  const rows = TIER_NAMES.map((name, index) => {
    const window =
      index === Tier.TRUSTED
        ? `${WINDOW_SECS_BY_TIER[Tier.TRUSTED]} s with a Trust account, ${HISTORY_TRUST_WINDOW_SECS} s from history`
        : `${WINDOW_SECS_BY_TIER[index as Tier]} s`;
    return `| ${name} | ${index} | ${window} |`;
  });
  return ['| Tier | On-chain value | Window |', '|---|---|---|', ...rows].join('\n');
}

export function groupCaps(): string {
  return Object.entries(GROUP_CAPS)
    .map(([source, cap]) => `\`${source}\`: at most ${cap} points in total`)
    .join('; ');
}

function duration(seconds: number): string {
  if (seconds % 3_600 === 0) return `${seconds / 3_600} h`;
  return `${seconds / 60} min`;
}

export function collectorTable(): string {
  const rows = ALL_COLLECTORS.map(
    (collector) =>
      `| \`${collector.name}\` | ${collector.timeoutMs / 1000} s | ${
        collector.cacheTtlSecs === null ? 'not cached' : duration(collector.cacheTtlSecs)
      } |`,
  );
  return ['| Collector | Time budget | Cached for |', '|---|---|---|', ...rows].join('\n');
}

const pct = (share: number) => `${Math.round(share * 100)}%`;
const daysOf = (seconds: number) => `${seconds / 86_400} days`;

/** Every threshold a collector applies, read from the constants that apply it. */
export function thresholdTable(): string {
  const rows: [string, string][] = [
    [
      'onchain_reputation.reclaimed_majority',
      `at least ${onchain.MIN_HOLDS_FOR_RATIO} holds received and ${pct(onchain.RECLAIM_MAJORITY_RATIO)} or more of them undone`,
    ],
    [
      'onchain_reputation.reclaimed_often',
      `at least ${onchain.MIN_HOLDS_FOR_RATIO} holds received and ${pct(onchain.RECLAIM_OFTEN_RATIO)} or more of them undone`,
    ],
    [
      'onchain_reputation.clean_releases',
      `at least ${onchain.CLEAN_RELEASES_MIN} completed payments, none undone, no flags`,
    ],
    [
      'helius (window)',
      `the last ${helius.PARSED_TX_LIMIT} parsed transactions; wallet age from up to ${helius.SIGNATURE_PAGES * helius.SIGNATURE_PAGE_SIZE} signatures`,
    ],
    [
      'helius.wallet_new_1d',
      `first transaction less than ${daysOf(helius.NEW_WALLET_1D_SECS)} ago`.replace(
        '1 days',
        '1 day',
      ),
    ],
    [
      'helius.wallet_new_7d',
      `first transaction less than ${daysOf(helius.NEW_WALLET_7D_SECS)} ago`,
    ],
    [
      'helius.wallet_established',
      `at least ${helius.ESTABLISHED_MIN_TXS} transactions, first one at least ${daysOf(helius.ESTABLISHED_AGE_SECS)} ago, no other Helius warning`,
    ],
    [
      'helius.sweep_pattern',
      `at least ${h.SWEEP_MIN_SENDERS} different senders pay in, and ${pct(h.SWEEP_MIN_SHARE)} or more of at least ${h.SWEEP_MIN_OUTBOUND} outgoing transfers go to the same ${h.SWEEP_MAX_DESTINATIONS} wallets or fewer`,
    ],
    [
      'helius.instant_drain',
      `of at least ${h.DRAIN_MIN_DEPOSITS} deposits (each ${h.DRAIN_MIN_SOL} SOL or ${h.DRAIN_MIN_TOKEN} token or more), ${pct(h.DRAIN_MIN_RATE)} or more are followed within ${h.DRAIN_WINDOW_SECS / 60} minutes by outgoing transfers of the same asset worth ${pct(h.DRAIN_MIN_OUT_SHARE)} of the deposit`,
    ],
    [
      'helius.dust_sprayer',
      `at least ${h.DUST_MIN_TRANSFERS} outgoing transfers of ${h.DUST_MAX_SOL} SOL or less, to at least ${h.DUST_MIN_RECIPIENTS} different wallets`,
    ],
    [
      'helius.burst_activity',
      `younger than ${daysOf(h.BURST_YOUNG_AGE_SECS)} with at least ${h.BURST_YOUNG_MIN_TXS} transactions, or younger than ${daysOf(h.BURST_AGE_SECS)} with at least ${h.BURST_HOUR_MIN_TXS} transactions inside one hour`,
    ],
    [
      'helius.prior_history_with_sender',
      `at least ${helius.PRIOR_HISTORY_MIN_TRANSFERS} earlier transfers from the sender in the window`,
    ],
    [
      'chainabuse.confirmed_reports',
      `any report marked trusted or checked, or at least ${chainabuse.CONFIRMED_MIN_REPORTS} reports; at most ${chainabuse.DEFAULT_MONTHLY_BUDGET} calls per month by default`,
    ],
    [
      'web_reports.scam_report',
      `one search of ${web.SEARCH_LIMIT} results, up to ${web.MAX_SCRAPES} extra scrapes; a page counts only if its text contains the exact address or name; quotes of at most ${MAX_QUOTE_WORDS} words that appear on the page`,
    ],
    [
      'sns.lookalike_name',
      `same shape after replacing look-alike characters, a well-known name wrapped in a word like "support", or within 1 edit of a well-known name of ${lookalike.MIN_LENGTH_FOR_EDIT_DISTANCE} letters or more (2 edits from ${lookalike.LONG_NAME_LENGTH} letters)`,
    ],
    [
      'context.*',
      `notes up to ${context.MAX_CONTEXT_CHARS} characters; a cue found only by the classifier needs confidence ${context.CLASSIFIER_MIN_CONFIDENCE} or more`,
    ],
    [
      'baseline.amount_above_typical',
      `${baseline.ABOVE_TYPICAL_FACTOR} times the median of at least ${baseline.MIN_PAYMENTS_FOR_MEDIAN} earlier payments in the same token (${baseline.FAR_ABOVE_TYPICAL_FACTOR} times for "far above")`,
    ],
    [
      'baseline.unusual_hour',
      `at least ${baseline.MIN_PAYMENTS_FOR_HOURS} earlier payments and under ${pct(baseline.UNUSUAL_HOUR_SHARE)} of them within an hour of this time of day (UTC)`,
    ],
  ];
  return [
    '| Signal | Fires when |',
    '|---|---|',
    ...rows.map(([signal, rule]) => `| \`${signal}\` | ${rule} |`),
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(
    [tierTable(), policyTable(), groupCaps(), collectorTable(), thresholdTable()].join('\n\n'),
  );
}
