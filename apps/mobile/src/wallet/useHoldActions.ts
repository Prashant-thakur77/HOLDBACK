import {
  buildTransaction,
  fetchHold,
  getMintInfo,
  instructions,
  type HoldRecord,
} from '@holdback/sdk';
import { PublicKey, type Connection, type TransactionInstruction } from '@solana/web3.js';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { queryKeys } from '@/data/keys';
import { WalletActionError } from '@/lib/walletErrors';

import { useWallet } from './WalletContext';

const ZERO_HASH = new Uint8Array(32);

/** Loads the on-chain hold and the token program of its mint: what the settle instructions need. */
async function loadHold(connection: Connection, pda: string) {
  const hold = await fetchHold(connection, new PublicKey(pda));
  if (!hold) throw new WalletActionError('failed', 'This hold no longer exists on-chain');
  const tokenProgram = hold.isSol
    ? undefined
    : (await getMintInfo(connection, hold.mint)).tokenProgram;
  return { hold, tokenProgram };
}

/**
 * The on-chain actions of the app. A wallet user signs each one; a Pollar
 * user can only undo, which goes through the relayer. Everything rejects with
 * `WalletActionError` (wallet users) or `PollarFlowError` (Pollar users).
 */
export function useHoldActions() {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const { address, kind, pollar, signAndConfirm } = wallet;

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.allHolds }),
      queryClient.invalidateQueries({ queryKey: ['hold'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.allBalances }),
      queryClient.invalidateQueries({ queryKey: ['trusted'] }),
      queryClient.invalidateQueries({ queryKey: ['flag'] }),
    ]);
  }, [queryClient]);

  /** Signs one instruction built from the connected wallet's address. */
  const sign = useCallback(
    async (
      make: (signer: PublicKey, connection: Connection) => Promise<TransactionInstruction>,
    ) => {
      if (kind !== 'mwa' || !address) {
        throw new WalletActionError('unsupported', 'This action needs a wallet that can sign');
      }
      const signature = await signAndConfirm(async (connection) =>
        buildTransaction(connection, address, [await make(address, connection)]),
      );
      await refresh();
      return signature;
    },
    [kind, address, signAndConfirm, refresh],
  );

  return useMemo(
    () => ({
      /** Bring the money back before the window ends. */
      undo: async (record: Pick<HoldRecord, 'pda'>): Promise<string> => {
        if (kind === 'pollar') {
          if (!pollar) throw new WalletActionError('unsupported', 'Pollar is not configured');
          const { signature } = await pollar.flow.undo(record.pda);
          await refresh();
          return signature;
        }
        return sign(async (signer, connection) => {
          const { hold, tokenProgram } = await loadHold(connection, record.pda);
          return instructions.reclaim({ authority: signer, hold, tokenProgram });
        });
      },

      /**
       * Pay the recipient. `early` (sender only) skips the rest of the window;
       * without it anyone may deliver a hold whose window is over.
       */
      release: (record: Pick<HoldRecord, 'pda'>, early: boolean): Promise<string> =>
        sign(async (signer, connection) => {
          const { hold, tokenProgram } = await loadHold(connection, record.pda);
          return instructions.release({ caller: signer, hold, early, tokenProgram });
        }),

      trust: (recipient: PublicKey): Promise<string> =>
        sign(async (signer) => instructions.setTrust({ sender: signer, recipient })),

      untrust: (recipient: PublicKey): Promise<string> =>
        sign(async (signer) => instructions.removeTrust({ sender: signer, recipient })),

      /** Records a scam report on-chain. One per reporter and subject. */
      report: (subject: PublicKey, reason: number, evidenceHash?: Uint8Array): Promise<string> =>
        sign(async (signer) =>
          instructions.flagSubject({
            reporter: signer,
            subject,
            reason,
            evidenceHash: evidenceHash ?? ZERO_HASH,
          }),
        ),

      refresh,
    }),
    [kind, pollar, sign, refresh],
  );
}
