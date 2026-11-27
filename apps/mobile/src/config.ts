/**
 * Build-time configuration. Every value is public (it ships inside the APK),
 * so nothing secret may ever be added here. `process.env.EXPO_PUBLIC_*` must
 * be read with a literal member access for the bundler to inline it.
 */
import { DEVNET_USDC_MINT, PROGRAM_ID } from '@holdback/sdk';
import { PublicKey } from '@solana/web3.js';

const trimmed = (value: string | undefined) => (value ?? '').trim();

function mintFrom(value: string): PublicKey {
  if (!value) return DEVNET_USDC_MINT;
  try {
    return new PublicKey(value);
  } catch {
    return DEVNET_USDC_MINT;
  }
}

const chain = trimmed(process.env.EXPO_PUBLIC_SOLANA_CHAIN) || 'solana:devnet';

export const config = {
  /** Risk agent base URL; empty when the build was made without one. */
  agentUrl: trimmed(process.env.EXPO_PUBLIC_AGENT_URL).replace(/\/+$/, ''),
  rpcUrl: trimmed(process.env.EXPO_PUBLIC_RPC_URL) || 'https://api.devnet.solana.com',
  chain: chain as `solana:${string}`,
  supabaseUrl: trimmed(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: trimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  pollarKey: trimmed(process.env.EXPO_PUBLIC_POLLAR_KEY),
  usdcMint: mintFrom(trimmed(process.env.EXPO_PUBLIC_USDC_MINT)),
  programId: PROGRAM_ID,
} as const;

export const hasAgent = config.agentUrl !== '';
export const hasSupabase = config.supabaseUrl !== '' && config.supabaseAnonKey !== '';
export const hasPollar = config.pollarKey !== '';

/** Cluster name for explorer links. */
export const explorerCluster = chain === 'solana:mainnet' ? null : chain.replace('solana:', '');

export function explorerUrl(kind: 'address' | 'tx', id: string): string {
  const query = explorerCluster ? `?cluster=${explorerCluster}` : '';
  return `https://explorer.solana.com/${kind}/${id}${query}`;
}
