/**
 * Facts about the configured Solana cluster that need no Solana library:
 * endpoints, chain ids and explorer links. Pages that only link to the
 * explorer import this module and stay free of `@solana/web3.js`.
 */
import { publicEnv, type Cluster } from './env';

/** CAIP-2 chain ids, as Solana Action clients expect them in `X-Blockchain-Ids`. */
export const CHAIN_IDS: Record<Cluster, string> = {
  'mainnet-beta': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  testnet: 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
  // A local validator has no registered id; devnet is the closest thing a client understands.
  localnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
};

/**
 * The public endpoint of each cluster, used when no RPC URL is configured.
 *
 * These endpoints refuse requests that come from Cloudflare Workers, so they
 * only serve the browser and local development. A deployed Worker needs
 * `SOLANA_RPC_URL` (see `solana.server.ts`).
 */
export const PUBLIC_RPC_URLS: Record<Cluster, string> = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  localnet: 'http://127.0.0.1:8899',
};

export function rpcUrl(override: string | null = publicEnv.rpcUrl): string {
  return override ?? PUBLIC_RPC_URLS[publicEnv.cluster];
}

/** Link to a transaction or account on Solana Explorer for the configured cluster. */
export function explorerUrl(kind: 'tx' | 'address', id: string): string {
  const base = `https://explorer.solana.com/${kind}/${id}`;
  switch (publicEnv.cluster) {
    case 'mainnet-beta':
      return base;
    case 'localnet':
      return `${base}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl())}`;
    default:
      return `${base}?cluster=${publicEnv.cluster}`;
  }
}
