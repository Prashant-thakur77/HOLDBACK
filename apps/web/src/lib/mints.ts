/**
 * What the app knows about the assets it handles without asking the chain:
 * native SOL and Circle's devnet USDC. Any other SPL or Token-2022 mint still
 * works; its decimals are read on demand with `resolveMint`.
 */
import { DEVNET_USDC_MINT, getMintInfo } from '@holdback/sdk';
import { PublicKey, type Connection } from '@solana/web3.js';

import { publicEnv, type Cluster } from './env';

export interface MintMeta {
  /** Mint address, or `null` for native SOL. */
  address: string | null;
  symbol: string;
  name: string;
  decimals: number;
}

export const SOL: MintMeta = { address: null, symbol: 'SOL', name: 'Solana', decimals: 9 };

export const DEVNET_USDC: MintMeta = {
  address: DEVNET_USDC_MINT.toBase58(),
  symbol: 'USDC',
  name: 'USD Coin (devnet)',
  decimals: 6,
};

/** The assets offered by default on a cluster. The devnet USDC mint exists only on devnet. */
export function knownMints(cluster: Cluster = publicEnv.cluster): MintMeta[] {
  return cluster === 'devnet' ? [SOL, DEVNET_USDC] : [SOL];
}

/** Metadata for a mint address (`null` = SOL), or `null` when the app has none. */
export function mintMeta(
  address: string | null,
  cluster: Cluster = publicEnv.cluster,
): MintMeta | null {
  return knownMints(cluster).find((mint) => mint.address === address) ?? null;
}

/**
 * Metadata for any mint. Known mints answer from the table; others are read
 * from the chain and labelled with a shortened address, because an arbitrary
 * mint's self-declared symbol is not something to show next to money.
 */
export async function resolveMint(
  connection: Connection,
  address: string | null,
  cluster: Cluster = publicEnv.cluster,
): Promise<MintMeta> {
  const known = mintMeta(address, cluster);
  if (known) return known;
  // `address` is not null here: SOL is always a known mint.
  const mint = address as string;
  const { decimals } = await getMintInfo(connection, new PublicKey(mint));
  const short = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  return { address: mint, symbol: short, name: `Token ${short}`, decimals };
}
