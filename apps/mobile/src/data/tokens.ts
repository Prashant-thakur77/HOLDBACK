import { getMintInfo } from '@holdback/sdk';
import { PublicKey, type Connection } from '@solana/web3.js';
import { useQuery } from '@tanstack/react-query';

import { config } from '@/config';
import { shortAddress } from '@/lib/address';
import { useWallet } from '@/wallet/WalletContext';

import { queryKeys } from './keys';

/** What the UI needs to show an amount of a token. */
export interface TokenMeta {
  /** Mint address, or `null` for native SOL. */
  mint: string | null;
  symbol: string;
  decimals: number;
  /** Token program that owns the mint; `null` for SOL. */
  tokenProgram: PublicKey | null;
}

export const SOL: TokenMeta = { mint: null, symbol: 'SOL', decimals: 9, tokenProgram: null };

const USDC_MINT = config.usdcMint.toBase58();

async function loadMeta(connection: Connection, mint: string): Promise<TokenMeta> {
  const info = await getMintInfo(connection, new PublicKey(mint));
  return {
    mint,
    symbol: mint === USDC_MINT ? 'USDC' : shortAddress(mint, 3),
    decimals: info.decimals,
    tokenProgram: info.tokenProgram,
  };
}

/**
 * Symbol and decimals for a mint, read from the chain (decimals are never
 * assumed: showing the wrong number of places would misstate an amount).
 * `undefined` while loading.
 */
export function useTokenMeta(mint: string | null | undefined): TokenMeta | undefined {
  const { connection } = useWallet();
  const query = useQuery({
    queryKey: queryKeys.mint(mint ?? 'SOL'),
    queryFn: () => loadMeta(connection, mint!),
    enabled: !!mint,
    staleTime: Infinity,
  });
  if (mint === null) return SOL;
  return query.data;
}

/** The payment token of this build (USDC unless configured otherwise). */
export function usePaymentToken(): TokenMeta | undefined {
  return useTokenMeta(USDC_MINT);
}

export { USDC_MINT };
