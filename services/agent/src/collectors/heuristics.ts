/**
 * Behaviour heuristics over a wallet's recent mainnet transfers. Every
 * function is pure and every threshold is a named constant, so the README
 * table and the tests describe exactly what runs.
 *
 * All of them look at the same window: the wallet's most recent parsed
 * transactions (at most 100).
 */

/** The fields of a Helius enhanced transaction that the heuristics read. */
export interface ParsedTx {
  signature: string;
  /** Unix seconds. */
  timestamp: number;
  nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount: number }[];
  tokenTransfers?: {
    fromUserAccount?: string;
    toUserAccount?: string;
    mint?: string;
    tokenAmount: number;
  }[];
}

/** One movement of one asset, in whole units (SOL, or the token's UI amount). */
export interface Transfer {
  timestamp: number;
  from: string;
  to: string;
  /** `SOL` or a mint address. */
  asset: string;
  amount: number;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Flattens transactions into transfers that touch `wallet`, oldest first. */
export function transfersOf(wallet: string, transactions: ParsedTx[]): Transfer[] {
  const transfers: Transfer[] = [];
  for (const tx of transactions) {
    for (const native of tx.nativeTransfers ?? []) {
      if (!native.fromUserAccount || !native.toUserAccount || native.amount <= 0) continue;
      transfers.push({
        timestamp: tx.timestamp,
        from: native.fromUserAccount,
        to: native.toUserAccount,
        asset: 'SOL',
        amount: native.amount / LAMPORTS_PER_SOL,
      });
    }
    for (const token of tx.tokenTransfers ?? []) {
      if (!token.fromUserAccount || !token.toUserAccount || !token.mint) continue;
      if (!(token.tokenAmount > 0)) continue;
      transfers.push({
        timestamp: tx.timestamp,
        from: token.fromUserAccount,
        to: token.toUserAccount,
        asset: token.mint,
        amount: token.tokenAmount,
      });
    }
  }
  return transfers
    .filter((transfer) => transfer.from !== transfer.to)
    .filter((transfer) => transfer.from === wallet || transfer.to === wallet)
    .sort((a, b) => a.timestamp - b.timestamp);
}

const inbound = (wallet: string, transfers: Transfer[]) =>
  transfers.filter((transfer) => transfer.to === wallet);
const outbound = (wallet: string, transfers: Transfer[]) =>
  transfers.filter((transfer) => transfer.from === wallet);

// Sweep pattern --------------------------------------------------------------

/** Distinct wallets that paid in. */
export const SWEEP_MIN_SENDERS = 5;
/** Outgoing transfers needed before their destinations are judged. */
export const SWEEP_MIN_OUTBOUND = 3;
/** The busiest destinations that may take almost everything. */
export const SWEEP_MAX_DESTINATIONS = 2;
/** Share of outgoing transfers (by count) going to those destinations. */
export const SWEEP_MIN_SHARE = 0.8;

/**
 * A collection wallet: at least 5 different senders pay in, and at least
 * 80% of at least 3 outgoing transfers go to the same one or two wallets.
 */
export function isSweepPattern(wallet: string, transfers: Transfer[]): boolean {
  const senders = new Set(inbound(wallet, transfers).map((transfer) => transfer.from));
  const out = outbound(wallet, transfers);
  if (senders.size < SWEEP_MIN_SENDERS || out.length < SWEEP_MIN_OUTBOUND) return false;
  const perDestination = new Map<string, number>();
  for (const transfer of out) {
    perDestination.set(transfer.to, (perDestination.get(transfer.to) ?? 0) + 1);
  }
  const top = [...perDestination.values()]
    .sort((a, b) => b - a)
    .slice(0, SWEEP_MAX_DESTINATIONS)
    .reduce((sum, count) => sum + count, 0);
  return top / out.length >= SWEEP_MIN_SHARE;
}

// Instant drain --------------------------------------------------------------

/** Smallest deposit that counts: 0.05 SOL, or 1 whole token. */
export const DRAIN_MIN_SOL = 0.05;
export const DRAIN_MIN_TOKEN = 1;
/** How quickly the money must leave again. */
export const DRAIN_WINDOW_SECS = 600;
/** Share of the deposit that must leave inside the window. */
export const DRAIN_MIN_OUT_SHARE = 0.9;
/** Qualifying deposits needed, and the share of them that must be drained. */
export const DRAIN_MIN_DEPOSITS = 3;
export const DRAIN_MIN_RATE = 0.6;

/**
 * A pass-through wallet: of at least 3 meaningful deposits, at least 60%
 * are followed within 10 minutes by outgoing transfers of the same asset
 * worth at least 90% of the deposit.
 */
export function isInstantDrain(wallet: string, transfers: Transfer[]): boolean {
  const out = outbound(wallet, transfers);
  const deposits = inbound(wallet, transfers).filter(
    (transfer) => transfer.amount >= (transfer.asset === 'SOL' ? DRAIN_MIN_SOL : DRAIN_MIN_TOKEN),
  );
  if (deposits.length < DRAIN_MIN_DEPOSITS) return false;
  const drained = deposits.filter((deposit) => {
    const left = out
      .filter(
        (transfer) =>
          transfer.asset === deposit.asset &&
          transfer.timestamp >= deposit.timestamp &&
          transfer.timestamp <= deposit.timestamp + DRAIN_WINDOW_SECS,
      )
      .reduce((sum, transfer) => sum + transfer.amount, 0);
    return left >= deposit.amount * DRAIN_MIN_OUT_SHARE;
  });
  return drained.length / deposits.length >= DRAIN_MIN_RATE;
}

// Dust sprayer ---------------------------------------------------------------

/** A dust transfer is at most 0.001 SOL. */
export const DUST_MAX_SOL = 0.001;
export const DUST_MIN_TRANSFERS = 20;
export const DUST_MIN_RECIPIENTS = 15;

/**
 * An address-poisoning or spam wallet: at least 20 outgoing SOL transfers
 * of at most 0.001 SOL, to at least 15 different wallets.
 */
export function isDustSprayer(wallet: string, transfers: Transfer[]): boolean {
  const dust = outbound(wallet, transfers).filter(
    (transfer) => transfer.asset === 'SOL' && transfer.amount <= DUST_MAX_SOL,
  );
  const recipients = new Set(dust.map((transfer) => transfer.to));
  return dust.length >= DUST_MIN_TRANSFERS && recipients.size >= DUST_MIN_RECIPIENTS;
}

// Burst activity -------------------------------------------------------------

/** A wallet younger than 3 days with at least 50 transactions. */
export const BURST_YOUNG_AGE_SECS = 3 * 86_400;
export const BURST_YOUNG_MIN_TXS = 50;
/** Or: younger than 30 days with at least 60 transactions inside one hour. */
export const BURST_AGE_SECS = 30 * 86_400;
export const BURST_HOUR_MIN_TXS = 60;
const HOUR_SECS = 3_600;

/**
 * A wallet that is far busier than its age explains. `ageSecs` is `null`
 * when the wallet's first transaction is beyond what was fetched, in which
 * case it is too old for this heuristic.
 */
export function isBurstActivity(
  ageSecs: number | null,
  txCount: number,
  timestamps: number[],
): boolean {
  if (ageSecs === null) return false;
  if (ageSecs < BURST_YOUNG_AGE_SECS && txCount >= BURST_YOUNG_MIN_TXS) return true;
  if (ageSecs >= BURST_AGE_SECS) return false;
  const sorted = [...timestamps].sort((a, b) => a - b);
  let start = 0;
  for (let end = 0; end < sorted.length; end++) {
    while (sorted[end]! - sorted[start]! > HOUR_SECS) start++;
    if (end - start + 1 >= BURST_HOUR_MIN_TXS) return true;
  }
  return false;
}

// Counterparties -------------------------------------------------------------

/** Every other wallet that sent to or received from `wallet`. */
export function counterparties(wallet: string, transfers: Transfer[]): string[] {
  const others = new Set<string>();
  for (const transfer of transfers) {
    others.add(transfer.from === wallet ? transfer.to : transfer.from);
  }
  others.delete(wallet);
  return [...others].sort();
}

/** How many transfers each wallet sent to `wallet`. */
export function inboundCounts(wallet: string, transfers: Transfer[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const transfer of inbound(wallet, transfers)) {
    counts[transfer.from] = (counts[transfer.from] ?? 0) + 1;
  }
  return counts;
}

/** The sender of the oldest SOL deposit in the list, if any. */
export function firstFunder(wallet: string, transfers: Transfer[]): string | null {
  const first = inbound(wallet, transfers).find((transfer) => transfer.asset === 'SOL');
  return first?.from ?? null;
}
