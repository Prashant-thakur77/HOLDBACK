/**
 * USD value of a payment, without a price feed.
 *
 * Only mints on a short list of USD stablecoins get a value, counted at par
 * (one token = one dollar). Every other asset, native SOL included, is left
 * without a USD amount rather than guessed at.
 */

/** Mint address -> decimals. */
export type Stablecoins = ReadonlyMap<string, number>;

/** Always recognised: Circle's USDC on devnet (the demo mint) and on mainnet. */
const BUILT_IN: readonly [string, number][] = [
  ['4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 6],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6],
];

/** A u64 amount has at most 20 digits; more decimals than that is a typo. */
const MAX_DECIMALS = 20;

/**
 * Parses `USD_STABLECOIN_MINTS`: comma-separated `mint:decimals` pairs that
 * are added to the built-in list. Throws on a malformed entry, so a typo
 * stops the function at start-up instead of silently dropping a mint.
 */
export function parseStablecoins(spec: string | undefined): Stablecoins {
  const mints = new Map<string, number>(BUILT_IN);
  for (const entry of (spec ?? '').split(',')) {
    const text = entry.trim();
    if (!text) continue;
    const match = /^([1-9A-HJ-NP-Za-km-z]{32,44}):(\d{1,2})$/.exec(text);
    const decimals = match ? Number(match[2]) : NaN;
    if (!match || decimals > MAX_DECIMALS) {
      throw new Error(`USD_STABLECOIN_MINTS: expected "<mint>:<decimals>", got "${text}"`);
    }
    mints.set(match[1]!, decimals);
  }
  return mints;
}

/**
 * Base units to dollars with two decimal places, rounded half up, as a
 * decimal string. Integer arithmetic only: the result is exact for any u64.
 */
export function toUsd(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const cents = (amount * 100n + scale / 2n) / scale;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** The USD value of `amount` of `mint`, or null when the mint is not a listed stablecoin. */
export function usdValue(
  stablecoins: Stablecoins,
  mint: string | null,
  amount: bigint,
): string | null {
  const decimals = mint === null ? undefined : stablecoins.get(mint);
  return decimals === undefined ? null : toUsd(amount, decimals);
}
