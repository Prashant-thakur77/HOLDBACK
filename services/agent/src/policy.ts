/**
 * The window policy. Pure and deterministic: signals in, tier and window
 * out. No clock, no network, no model. The language model writes the
 * spoken explanation afterwards and has no input here.
 *
 * Changing any rule, weight or threshold changes what a given evidence
 * document means, so `POLICY_VERSION` must change with it: the version is
 * part of the hashed document.
 */
import {
  TIER_NAMES,
  Tier,
  WINDOW_SECS_BY_TIER,
  type EvidenceItem,
  type Finding,
  type TierName,
} from '@holdback/sdk';

import { ruleId, type Signal } from './signals';

export const POLICY_VERSION = 'holdback-policy/1.0.0';

/** Score at which a recipient becomes SUSPICIOUS, and FLAGGED. */
export const SUSPICIOUS_SCORE = 30;
export const FLAGGED_SCORE = 60;
export const MAX_SCORE = 100;

/** Released holds to the same recipient that enable the history fast path. */
export const TRUSTED_HISTORY_MIN_RELEASES = 3;

/**
 * Window for a recipient trusted through history rather than a `Trust`
 * account. The program's zero-window path requires the `Trust` account, so
 * this is the shortest hold it accepts.
 */
export const HISTORY_TRUST_WINDOW_SECS = 1;

/** What a rule does besides adding points. */
type Effect = 'sanctioned' | 'confirmed_scam' | 'trust_account' | 'trusted_history';

export interface Rule {
  /** Shown as the finding title. */
  title: string;
  /** Points per signal, or per unit of `value` when `perUnit` is set. */
  points: number;
  perUnit?: boolean;
  /** Upper bound on what this rule can contribute. */
  cap?: number;
  effect?: Effect;
}

/**
 * Every rule the policy knows. A signal whose id is not in this table is
 * ignored, so a collector cannot invent weight.
 */
export const RULES: Record<string, Rule> = {
  // Our own program's reputation counters and the sender's trust account.
  'onchain_reputation.trust_account': {
    title: 'You marked this recipient as trusted',
    points: 0,
    effect: 'trust_account',
  },
  'onchain_reputation.onchain_flags': {
    title: 'Other HOLDBACK users flagged this address on-chain',
    points: 15,
    perUnit: true,
    cap: 45,
  },
  'onchain_reputation.reclaimed_majority': {
    title: 'Most payments to this address were pulled back by their senders',
    points: 30,
  },
  'onchain_reputation.reclaimed_often': {
    title: 'Senders have often pulled payments back from this address',
    points: 15,
  },
  'onchain_reputation.clean_releases': {
    title: 'Several payments to this address completed without an undo',
    points: -10,
  },
  'onchain_reputation.no_onchain_flags': { title: 'No on-chain flags', points: 0 },
  'onchain_reputation.offchain_flags': {
    title: 'This address was reported to HOLDBACK',
    points: 10,
    perUnit: true,
    cap: 30,
  },
  'onchain_reputation.no_offchain_flags': { title: 'No reports to HOLDBACK', points: 0 },

  // Mainnet wallet history.
  'helius.wallet_new_1d': { title: 'This wallet was created in the last day', points: 15 },
  'helius.wallet_new_7d': { title: 'This wallet is less than a week old', points: 8 },
  'helius.wallet_established': { title: 'Long-lived wallet with steady activity', points: -10 },
  'helius.no_history': { title: 'This address has never been used on mainnet', points: 5 },
  'helius.sweep_pattern': {
    title: 'Collects from many senders and forwards to one or two wallets',
    points: 25,
  },
  'helius.instant_drain': {
    title: 'Incoming funds are moved out within minutes',
    points: 25,
  },
  'helius.dust_sprayer': { title: 'Sends tiny amounts to many wallets', points: 20 },
  'helius.burst_activity': { title: 'Unusual burst of activity for a new wallet', points: 15 },
  'helius.known_bad_counterparty': {
    title: 'Transacted with an address on a scam or sanctions list',
    points: 20,
  },
  'helius.funded_by_known_bad': {
    title: 'First funded by an address on a scam or sanctions list',
    points: 25,
  },
  'helius.prior_history_with_sender': {
    title: 'You have paid this wallet before on mainnet',
    points: -10,
  },

  // Static lists.
  'blocklist.ofac_sanctioned': {
    title: 'This address is on the OFAC sanctions list',
    points: 100,
    effect: 'sanctioned',
  },
  'blocklist.scam_list_address': {
    title: 'This address is on a published scam list',
    points: 70,
    effect: 'confirmed_scam',
  },
  'blocklist.phishing_domain_in_context': {
    title: 'Your note mentions a known phishing site',
    points: 40,
  },
  'blocklist.not_listed': { title: 'Not on any scam or sanctions list', points: 0 },

  // Chainabuse.
  'chainabuse.confirmed_reports': {
    title: 'Confirmed scam reports on Chainabuse',
    points: 60,
    effect: 'confirmed_scam',
  },
  'chainabuse.unconfirmed_reports': {
    title: 'Unverified scam reports on Chainabuse',
    points: 25,
    perUnit: true,
    cap: 50,
  },
  'chainabuse.no_reports': { title: 'No reports on Chainabuse', points: 0 },

  // Web pages that name the exact address or name.
  'web_reports.scam_report': {
    title: 'Web pages describe this exact address as a scam',
    points: 20,
    perUnit: true,
    cap: 40,
  },
  'web_reports.recipient_is_token_mint': {
    title: 'This address is a token mint, not a wallet',
    points: 10,
  },
  'web_reports.recipient_is_program': {
    title: 'This address is a program, not a wallet',
    points: 10,
  },
  'web_reports.no_reports': { title: 'No scam reports found on the web', points: 0 },

  // Names.
  'sns.lookalike_name': {
    title: 'Its .sol name imitates a well-known name',
    points: 30,
  },
  'sns.sol_name': { title: 'Has a .sol name', points: 0 },

  // What the sender said about the payment. Capped as a group, see GROUP_CAPS.
  'context.remote_access': {
    title: 'A remote-access or screen-sharing app is involved',
    points: 30,
  },
  'context.secret_request': { title: 'Someone asked for an OTP, PIN or seed phrase', points: 30 },
  'context.authority': {
    title: 'Someone claims to be police, an official or support staff',
    points: 25,
  },
  'context.verification_transfer': {
    title: 'The payment is described as a verification or test transfer',
    points: 25,
  },
  'context.advance_fee': { title: 'A fee is demanded before money is released', points: 20 },
  'context.guaranteed_returns': {
    title: 'Guaranteed or unusually high returns are promised',
    points: 20,
  },
  'context.account_unlock': {
    title: 'The payment is meant to unlock an account or pass KYC',
    points: 20,
  },
  'context.gift_cards': { title: 'Gift cards or voucher codes are involved', points: 20 },
  'context.secrecy': { title: 'You were told to keep this secret', points: 15 },
  'context.urgency': { title: 'You are being rushed', points: 10 },

  // The sender's own history with HOLDBACK.
  'baseline.released_to_recipient': {
    title: 'You have completed payments to this recipient before',
    points: 0,
    effect: 'trusted_history',
  },
  'baseline.prior_reclaim_from_recipient': {
    title: 'You have undone a payment to this recipient before',
    points: 15,
  },
  'baseline.amount_far_above_typical': {
    title: 'Far larger than your usual payment',
    points: 15,
  },
  'baseline.amount_above_typical': { title: 'Larger than your usual payment', points: 10 },
  'baseline.unusual_hour': { title: 'Unusual time of day for you', points: 5 },
  'baseline.first_payment_to_recipient': {
    title: 'First payment to this recipient through HOLDBACK',
    points: 0,
  },
};

/** Most a whole source may add, so one long note cannot outweigh every other source. */
export const GROUP_CAPS: Partial<Record<Signal['source'], number>> = { context: 60 };

export interface Decision {
  score: number;
  tier: TierName;
  tierIndex: Tier;
  windowSecs: number;
  findings: Finding[];
  evidence: EvidenceItem[];
  requiresConfirmation: boolean;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical order, so the evidence list does not depend on which collector answered first. */
function canonicalOrder(signals: Signal[]): Signal[] {
  return [...signals].sort(
    (a, b) =>
      compare(ruleId(a), ruleId(b)) ||
      compare(a.url ?? '', b.url ?? '') ||
      compare(a.detail, b.detail),
  );
}

function level(points: number, effect: Effect | undefined): Finding['level'] {
  if (effect === 'sanctioned' || effect === 'confirmed_scam' || points >= 25) return 'critical';
  return points > 0 ? 'warning' : 'info';
}

/**
 * Points for each signal of one rule, in order. Per-unit rules spend their
 * cap from the first signal on, so the weights always add up to what the
 * rule contributed.
 */
function ruleWeights(rule: Rule, signals: Signal[]): number[] {
  let remaining = rule.cap ?? Number.POSITIVE_INFINITY;
  return signals.map((signal, index) => {
    const wanted = rule.perUnit ? rule.points * Math.max(1, signal.value ?? 1) : rule.points;
    // A rule that is not per-unit counts once however many signals repeat it.
    if (!rule.perUnit && index > 0) return 0;
    if (wanted <= 0) return wanted;
    const granted = Math.min(wanted, remaining);
    remaining -= granted;
    return granted;
  });
}

/** Turns signals into the scored evidence list, findings, tier and window. */
export function decide(signals: Signal[]): Decision {
  const known = canonicalOrder(signals.filter((signal) => ruleId(signal) in RULES));

  const byRule = new Map<string, number[]>();
  known.forEach((signal, index) => {
    const id = ruleId(signal);
    byRule.set(id, [...(byRule.get(id) ?? []), index]);
  });

  const weights = new Array<number>(known.length).fill(0);
  for (const [id, indexes] of byRule) {
    const granted = ruleWeights(
      RULES[id]!,
      indexes.map((index) => known[index]!),
    );
    indexes.forEach((index, position) => (weights[index] = granted[position]!));
  }

  // Group caps: trim the smallest contributions first, deterministically.
  for (const [source, cap] of Object.entries(GROUP_CAPS)) {
    const members = known
      .map((signal, index) => ({ signal, index }))
      .filter(({ signal, index }) => signal.source === source && weights[index]! > 0)
      .sort(
        (a, b) =>
          weights[b.index]! - weights[a.index]! || compare(ruleId(a.signal), ruleId(b.signal)),
      );
    let remaining = cap;
    for (const { index } of members) {
      const granted = Math.min(weights[index]!, remaining);
      weights[index] = granted;
      remaining -= granted;
    }
  }

  const evidence: EvidenceItem[] = known.map((signal, index) => ({
    source: signal.source,
    signal: signal.signal,
    weight: weights[index]!,
    detail: signal.detail,
    url: signal.url,
    quote: signal.quote,
    matched: signal.matched,
    date: signal.date,
  }));

  const findings: Finding[] = [...byRule.entries()]
    .map(([id, indexes]) => {
      const points = indexes.reduce((sum, index) => sum + weights[index]!, 0);
      return {
        id,
        title: RULES[id]!.title,
        points,
        level: level(points, RULES[id]!.effect),
        evidence: indexes,
      };
    })
    .sort((a, b) => b.points - a.points || compare(a.id, b.id));

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const score = Math.max(0, Math.min(MAX_SCORE, Math.round(total)));

  const effects = new Set<Effect>();
  for (const id of byRule.keys()) {
    const effect = RULES[id]!.effect;
    if (effect) effects.add(effect);
  }
  const releases = known
    .filter((signal) => ruleId(signal) === 'baseline.released_to_recipient')
    .reduce((most, signal) => Math.max(most, signal.value ?? 1), 0);
  const flagsKnownZero =
    byRule.has('onchain_reputation.no_onchain_flags') &&
    byRule.has('onchain_reputation.no_offchain_flags');

  let tierIndex: Tier;
  let windowSecs: number;
  if (effects.has('sanctioned')) {
    tierIndex = Tier.SANCTIONED;
  } else if (effects.has('trust_account')) {
    tierIndex = Tier.TRUSTED;
  } else if (effects.has('confirmed_scam') || score >= FLAGGED_SCORE) {
    tierIndex = Tier.FLAGGED;
  } else if (score >= SUSPICIOUS_SCORE) {
    tierIndex = Tier.SUSPICIOUS;
  } else if (releases >= TRUSTED_HISTORY_MIN_RELEASES && flagsKnownZero) {
    tierIndex = Tier.TRUSTED;
  } else {
    tierIndex = Tier.UNKNOWN;
  }
  windowSecs = WINDOW_SECS_BY_TIER[tierIndex];
  if (tierIndex === Tier.TRUSTED && !effects.has('trust_account')) {
    windowSecs = HISTORY_TRUST_WINDOW_SECS;
  }

  return {
    score,
    tier: TIER_NAMES[tierIndex],
    tierIndex,
    windowSecs,
    findings,
    evidence,
    requiresConfirmation: tierIndex === Tier.SANCTIONED,
  };
}
