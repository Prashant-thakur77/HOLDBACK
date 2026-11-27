'use client';

import {
  buildTransaction,
  fetchHold,
  getMintInfo,
  instructions,
  type FlagReason,
  type Hold,
  type HoldRecord,
} from '@holdback/sdk';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { useCallback, useState } from 'react';

import { holdPermissions, type HoldPermissions } from '@/lib/holds';
import { sendAndConfirm, toTxError, txError, type TxError } from '@/lib/tx';

export type HoldAction =
  'reclaim' | 'releaseEarly' | 'release' | 'setTrust' | 'removeTrust' | 'flag' | 'close';

export interface HoldActions {
  /** The action in flight, or `null`. One at a time. */
  pending: HoldAction | null;
  error: TxError | null;
  /** Signature of the last action that confirmed. */
  signature: string | null;
  /** What the connected wallet may do right now; hints, the program decides. */
  permissions: (now?: number) => HoldPermissions;
  /** Undo: returns the money to the sender while the window is open. */
  reclaim: () => Promise<string | null>;
  /** The sender pays the recipient before the window ends. */
  releaseEarly: () => Promise<string | null>;
  /** Anyone pays the recipient once the window is over. */
  release: () => Promise<string | null>;
  /** Marks the recipient as trusted: later payments to them can be instant. */
  setTrust: () => Promise<string | null>;
  removeTrust: () => Promise<string | null>;
  /** Files an on-chain scam flag against the recipient, citing this hold's evidence. */
  flag: (reason: FlagReason) => Promise<string | null>;
  /** Closes a settled hold and returns its rent to whoever paid it. */
  close: () => Promise<string | null>;
}

type Build = (context: {
  hold: Hold;
  wallet: PublicKey;
  tokenProgram: PublicKey | undefined;
}) => TransactionInstruction;

/**
 * Every instruction a wallet can sign about one hold.
 *
 * Each action first reads the hold account from the chain, not from the
 * record the page was given: the instruction needs fields only the account
 * has (the rent payer, the token program), and the mirror may be behind.
 */
export function useHoldActions(hold: Pick<HoldRecord, 'pda'> | HoldRecord | null): HoldActions {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [pending, setPending] = useState<HoldAction | null>(null);
  const [error, setError] = useState<TxError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const pda = hold?.pda ?? null;

  const run = useCallback(
    async (action: HoldAction, build: Build) => {
      const fail = (failure: TxError) => {
        setError(failure);
        return null;
      };
      if (!pda) return fail(txError('invalid_input', 'No hold selected'));
      if (!wallet.publicKey) return fail(txError('wallet_not_connected', 'Connect a wallet first'));
      if (pending) return fail(txError('invalid_input', 'Another action is still in progress'));

      setPending(action);
      setError(null);
      try {
        const account = await fetchHold(connection, new PublicKey(pda));
        if (!account) {
          // A closed hold has no account; only settled holds can be closed.
          return fail(txError('invalid_input', 'This hold no longer exists on-chain'));
        }
        const tokenProgram = account.isSol
          ? undefined
          : (await getMintInfo(connection, account.mint)).tokenProgram;
        const instruction = build({ hold: account, wallet: wallet.publicKey, tokenProgram });
        const built = await buildTransaction(connection, wallet.publicKey, [instruction]);
        const sent = await sendAndConfirm(connection, wallet, built);
        setSignature(sent);
        return sent;
      } catch (failure) {
        return fail(toTxError(failure));
      } finally {
        setPending(null);
      }
    },
    [connection, wallet, pda, pending],
  );

  const record = hold && 'status' in hold ? hold : null;
  const walletAddress = wallet.publicKey?.toBase58() ?? null;
  const permissions = useCallback(
    (now?: number): HoldPermissions =>
      record
        ? holdPermissions(record, walletAddress, now)
        : {
            reclaim: false,
            releaseEarly: false,
            release: false,
            close: false,
            manageRecipient: false,
          },
    [record, walletAddress],
  );

  return {
    pending,
    error,
    signature,
    permissions,
    reclaim: () =>
      run('reclaim', ({ hold: account, wallet: authority, tokenProgram }) =>
        instructions.reclaim({ authority, hold: account, tokenProgram }),
      ),
    releaseEarly: () =>
      run('releaseEarly', ({ hold: account, wallet: caller, tokenProgram }) =>
        instructions.release({ caller, hold: account, early: true, tokenProgram }),
      ),
    release: () =>
      run('release', ({ hold: account, wallet: caller, tokenProgram }) =>
        instructions.release({ caller, hold: account, early: false, tokenProgram }),
      ),
    setTrust: () =>
      run('setTrust', ({ hold: account, wallet: sender }) =>
        instructions.setTrust({ sender, recipient: account.recipient }),
      ),
    removeTrust: () =>
      run('removeTrust', ({ hold: account, wallet: sender }) =>
        instructions.removeTrust({ sender, recipient: account.recipient }),
      ),
    flag: (reason) =>
      run('flag', ({ hold: account, wallet: reporter }) =>
        instructions.flagSubject({
          reporter,
          subject: account.recipient,
          reason,
          evidenceHash: account.evidenceHash,
        }),
      ),
    close: () =>
      run('close', ({ hold: account, wallet: caller }) =>
        instructions.closeHold({ caller, hold: account }),
      ),
  };
}
