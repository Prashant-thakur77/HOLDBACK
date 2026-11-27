import {
  fetchHold,
  fetchHoldsByRecipient,
  fetchHoldsBySender,
  type HoldReceipt,
  type HoldRecord,
} from '@holdback/sdk';
import { PublicKey, type Connection } from '@solana/web3.js';
import { useQuery } from '@tanstack/react-query';

import { hasAgent } from '@/config';
import { toPublicKey } from '@/lib/address';
import { recordFromChain } from '@/lib/holds';
import { useWallet } from '@/wallet/WalletContext';

import { guardian } from './guardian';
import { queryKeys } from './keys';

/** How often lists refresh when no live channel is open. */
export const POLL_INTERVAL_MS = 15_000;

export interface HoldList {
  records: HoldRecord[];
  /**
   * `agent`: the Guardian service's mirror, which also remembers settled
   * holds. `chain`: read straight from the program when the service cannot be
   * reached; closed holds are not visible there.
   */
  source: 'agent' | 'chain';
}

async function loadHolds(
  connection: Connection,
  wallet: PublicKey,
  role: 'sender' | 'recipient',
): Promise<HoldList> {
  if (hasAgent) {
    try {
      const { holds } = await guardian.holds(wallet.toBase58(), role);
      return { records: holds, source: 'agent' };
    } catch {
      // fall through to the chain: the user's money is there whether or not our server is up
    }
  }
  const onChain =
    role === 'sender'
      ? await fetchHoldsBySender(connection, wallet)
      : await fetchHoldsByRecipient(connection, wallet);
  return { records: onChain.map(recordFromChain), source: 'chain' };
}

/**
 * Holds sent by (or addressed to) the connected wallet. `live` turns the
 * polling off because a Realtime channel is pushing changes instead.
 */
export function useHolds(role: 'sender' | 'recipient', live = false) {
  const { address, connection } = useWallet();
  const wallet = address?.toBase58() ?? '';
  return useQuery({
    queryKey: queryKeys.holds(wallet, role),
    queryFn: () => loadHolds(connection, address!, role),
    enabled: !!address,
    refetchInterval: live ? false : POLL_INTERVAL_MS,
    staleTime: 5_000,
  });
}

async function loadReceipt(connection: Connection, pda: PublicKey): Promise<HoldReceipt | null> {
  if (hasAgent) {
    try {
      return await guardian.receipt(pda.toBase58());
    } catch {
      // fall through to the chain
    }
  }
  const hold = await fetchHold(connection, pda);
  if (!hold) return null;
  return { hold: recordFromChain(hold), document: null, spoken: {}, voiceNoteUrl: null };
}

/** One hold with its evidence. `null` data means it does not exist (or was closed). */
export function useHold(pda: string | undefined) {
  const { connection } = useWallet();
  const key = toPublicKey(pda);
  return useQuery({
    queryKey: queryKeys.hold(pda ?? ''),
    queryFn: () => loadReceipt(connection, key!),
    enabled: !!key,
    refetchInterval: (query) =>
      query.state.data?.hold.status === 'PENDING' ? POLL_INTERVAL_MS : false,
  });
}
