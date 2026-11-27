import { DEVNET_USDC_MINT, getMintInfo, parseAmount } from '@holdback/sdk';
import { PublicKey, type Connection } from '@solana/web3.js';

import { parseAddress } from './context';
import { ToolError } from './errors';

/** What a tool needs to know about the asset being paid. */
export interface Asset {
  /** `null` for native SOL. */
  mint: PublicKey | null;
  /** `SOL`, or the mint address. This is how the asset appears in results. */
  id: string;
  symbol: string;
  decimals: number;
  /** The token program that owns the mint; `null` for SOL. */
  tokenProgram: PublicKey | null;
}

const SOL: Asset = { mint: null, id: 'SOL', symbol: 'SOL', decimals: 9, tokenProgram: null };

/** Mints whose symbol is worth showing; everything else is described as "tokens". */
const SYMBOLS: Record<string, string> = {
  [DEVNET_USDC_MINT.toBase58()]: 'USDC',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
};

/**
 * Looks up mints once per process. Decimals and the owning token program
 * never change for a mint, so caching them is always correct.
 */
export class AssetRegistry {
  private readonly known = new Map<string, Asset>();

  constructor(private readonly connection: Connection) {}

  /** Resolves the `mint` tool argument: the literal `SOL` or a mint address. */
  resolve(input: string): Promise<Asset> {
    if (input.trim().toUpperCase() === 'SOL') return Promise.resolve(SOL);
    return this.forMint(parseAddress(input.trim(), 'mint'));
  }

  /** Resolves `Hold.mint`, where the default public key marks a SOL hold. */
  async forMint(mint: PublicKey): Promise<Asset> {
    if (mint.equals(PublicKey.default)) return SOL;
    const id = mint.toBase58();
    const cached = this.known.get(id);
    if (cached) return cached;
    let info;
    try {
      info = await getMintInfo(this.connection, mint);
    } catch (failure) {
      throw new ToolError('unknown_mint', failure instanceof Error ? failure.message : id);
    }
    const asset: Asset = {
      mint,
      id,
      symbol: SYMBOLS[id] ?? 'tokens',
      decimals: info.decimals,
      tokenProgram: info.tokenProgram,
    };
    this.known.set(id, asset);
    return asset;
  }
}

/** Converts a display amount such as `12.5` to base units, refusing zero. */
export function toBaseUnits(amount: string, asset: Asset): bigint {
  let base: bigint;
  try {
    base = parseAmount(amount, asset.decimals);
  } catch {
    throw new ToolError(
      'invalid_amount',
      `amount must be a positive decimal with at most ${asset.decimals} decimal places`,
    );
  }
  if (base <= 0n) throw new ToolError('invalid_amount', 'amount must be greater than zero');
  return base;
}

/**
 * True when `base` units of an asset with `decimals` exceed `cap`, a decimal
 * string in display units. Both sides are scaled to a common power of ten so
 * the comparison is exact for any mint.
 */
export function exceedsCap(base: bigint, decimals: number, cap: string): boolean {
  const capDecimals = cap.split('.')[1]?.length ?? 0;
  const scale = Math.max(decimals, capDecimals);
  return base * 10n ** BigInt(scale - decimals) > parseAmount(cap, scale);
}
