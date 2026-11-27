/** USD value of a payment: at par for the mirror, with a SOL price for call thresholds. */
import { DEVNET_USDC_MINT } from '@holdback/sdk';

import type { Services } from '../services';
import { requestJson } from './http';

const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_MINTS = new Set([MAINNET_USDC, DEVNET_USDC_MINT.toBase58()]);
const USDC_DECIMALS = 6n;

/**
 * The value stored in the mirror's `amount_usd`: USDC at par, two decimal
 * places, exact; `null` for every other asset. The chain webhook uses the
 * same rule, so both writers agree on every hold.
 */
export function stablecoinUsd(mint: string | null, amount: bigint): string | null {
  if (mint === null || !USDC_MINTS.has(mint)) return null;
  const scale = 10n ** USDC_DECIMALS;
  const cents = (amount * 100n + scale / 2n) / scale;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

const SOL_PRICE_URL = 'https://coins.llama.fi/prices/current/coingecko:solana';
const PRICE_TTL_SECS = 600;

async function solPrice(services: Services): Promise<number> {
  return services.cache.wrap('price', 'SOL', PRICE_TTL_SECS, async () => {
    const answer = (await requestJson(SOL_PRICE_URL, { timeoutMs: 4_000 })) as {
      coins?: Record<string, { price?: number }>;
    };
    const price = answer.coins?.['coingecko:solana']?.price;
    if (typeof price !== 'number') throw new Error('no SOL price');
    return price;
  });
}

/**
 * Approximate USD value of `amount` base units of `mint` (`null` = SOL),
 * used only to decide whether a payment is large enough for a phone call.
 * Returns `null` for tokens other than USDC and when the SOL price cannot
 * be fetched.
 */
export async function usdValue(
  services: Services,
  mint: string | null,
  amount: bigint,
): Promise<number | null> {
  if (mint !== null) {
    return USDC_MINTS.has(mint) ? Number(amount) / 1_000_000 : null;
  }
  try {
    return (Number(amount) / 1_000_000_000) * (await solPrice(services));
  } catch {
    return null;
  }
}
