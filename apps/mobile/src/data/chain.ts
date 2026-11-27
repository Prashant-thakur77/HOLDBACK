import {
  associatedTokenAddress,
  fetchConfig,
  fetchTrustedRecipients,
  flagPda,
  isTrusted,
  type SeekerVerification,
} from '@holdback/sdk';
import { PublicKey, type Connection } from '@solana/web3.js';
import { useQuery } from '@tanstack/react-query';

import { hasAgent } from '@/config';
import { toPublicKey } from '@/lib/address';
import {
  DEFAULT_MAX_WINDOW_SECS,
  DEFAULT_MIN_WINDOW_SECS,
  DEFAULT_POLICY_WINDOW_SECS,
} from '@/lib/window';
import { useWallet } from '@/wallet/WalletContext';

import { guardian } from './guardian';
import { queryKeys } from './keys';
import { usePaymentToken, type TokenMeta } from './tokens';

export interface Balances {
  /** Lamports. */
  sol: bigint;
  /** Base units of the payment token; `0n` when the wallet has no token account yet. */
  token: bigint;
  /** Payment-token balance of the user's deposit box (Pollar users), else `null`. */
  box: bigint | null;
}

async function tokenBalance(connection: Connection, account: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(account, 'confirmed');
  if (!info) return 0n;
  const balance = await connection.getTokenAccountBalance(account, 'confirmed');
  return BigInt(balance.value.amount);
}

async function loadBalances(
  connection: Connection,
  owner: PublicKey,
  token: TokenMeta,
  boxTokenAccount: string | null,
): Promise<Balances> {
  const tokenProgram = token.tokenProgram ?? undefined;
  const ata = associatedTokenAddress(owner, new PublicKey(token.mint!), tokenProgram);
  const [sol, held, box] = await Promise.all([
    connection.getBalance(owner, 'confirmed'),
    tokenBalance(connection, ata),
    boxTokenAccount ? tokenBalance(connection, new PublicKey(boxTokenAccount)) : null,
  ]);
  return { sol: BigInt(sol), token: held, box };
}

/** SOL and payment-token balances of the connected wallet. */
export function useBalances() {
  const { address, connection, pollar, kind } = useWallet();
  const token = usePaymentToken();
  const boxTokenAccount =
    kind === 'pollar' ? (pollar?.state.session?.boxTokenAccount ?? null) : null;
  return useQuery({
    queryKey: [...queryKeys.balances(address?.toBase58() ?? ''), boxTokenAccount],
    queryFn: () => loadBalances(connection, address!, token!, boxTokenAccount),
    enabled: !!address && !!token?.mint,
    refetchInterval: 30_000,
  });
}

/** The program's window limits and pause switch. Falls back to the program defaults until read. */
export function useProgramConfig() {
  const { connection } = useWallet();
  const query = useQuery({
    queryKey: queryKeys.programConfig,
    queryFn: () => fetchConfig(connection),
    staleTime: 5 * 60_000,
  });
  return {
    minWindowSecs: query.data?.minWindowSecs ?? DEFAULT_MIN_WINDOW_SECS,
    maxWindowSecs: query.data?.maxWindowSecs ?? DEFAULT_MAX_WINDOW_SECS,
    /** Window used when the risk agent cannot be asked. */
    defaultWindowSecs: query.data?.defaultWindowSecs ?? DEFAULT_POLICY_WINDOW_SECS,
    paused: query.data?.paused ?? false,
    /** False when the program's config account does not exist on this cluster. */
    deployed: query.isSuccess ? query.data !== null : null,
  };
}

/** Everyone the connected wallet has marked as trusted, newest first. */
export function useTrustedPeople() {
  const { address, connection } = useWallet();
  return useQuery({
    queryKey: queryKeys.trusted(address?.toBase58() ?? ''),
    queryFn: async () => {
      const list = await fetchTrustedRecipients(connection, address!);
      return list.sort((a, b) => b.createdAt - a.createdAt);
    },
    enabled: !!address,
  });
}

/** Whether the connected wallet trusts `recipient`. `undefined` while unknown. */
export function useIsTrusted(recipient: string | null): boolean | undefined {
  const { address, connection } = useWallet();
  const key = toPublicKey(recipient);
  const query = useQuery({
    queryKey: queryKeys.isTrusted(address?.toBase58() ?? '', recipient ?? ''),
    queryFn: () => isTrusted(connection, address!, key!),
    enabled: !!address && !!key,
  });
  return query.data;
}

/** Seeker Genesis Token check, SKR balance and `.skr` name, from the agent. */
export function useSeeker() {
  const { address } = useWallet();
  const wallet = address?.toBase58() ?? '';
  return useQuery<SeekerVerification>({
    queryKey: queryKeys.seeker(wallet),
    queryFn: () => guardian.seeker(wallet),
    enabled: hasAgent && !!address,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/**
 * Whether the connected wallet has already reported `subject` on-chain. The
 * program allows one report per reporter and subject, so the button is hidden
 * instead of letting a second report fail.
 */
export function useHasReported(subject: string | null): boolean {
  const { address, connection } = useWallet();
  const key = toPublicKey(subject);
  const query = useQuery({
    queryKey: ['flag', address?.toBase58() ?? '', subject ?? ''],
    queryFn: async () => (await connection.getAccountInfo(flagPda(address!, key!))) !== null,
    enabled: !!address && !!key,
  });
  return query.data === true;
}
