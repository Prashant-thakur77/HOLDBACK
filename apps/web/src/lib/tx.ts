/**
 * Sending transactions from a connected wallet, and one error type for
 * everything that can go wrong on the way. Hooks expose `TxError` so pages
 * can switch on `kind` instead of parsing wallet and RPC messages.
 */
import {
  GuardianError,
  parseProgramError,
  type BuiltTransaction,
  type HoldbackProgramError,
} from '@holdback/sdk';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import type { Connection } from '@solana/web3.js';

import { IntegrationUnavailableError, errorMessage } from './errors';

export type TxErrorKind =
  /** No wallet is connected, or it cannot do what the action needs. */
  | 'wallet_not_connected'
  /** The input was refused before anything was sent (bad address, zero amount, ...). */
  | 'invalid_input'
  /** The risk agent is not configured or did not answer. */
  | 'agent_unavailable'
  /** The agent answered with an error for this request. */
  | 'assessment_failed'
  /** A sanctioned recipient needs the user's explicit confirmation first. */
  | 'confirmation_required'
  /** The pre-sign simulation failed; nothing was signed. */
  | 'simulation_failed'
  /** The HOLDBACK program refused the instruction; `program` says why. */
  | 'program_error'
  /** The user declined in the wallet. */
  | 'rejected'
  /** The blockhash expired before the transaction landed. Safe to retry. */
  | 'expired'
  /** Any other wallet or RPC failure. */
  | 'send_failed';

export interface TxError {
  kind: TxErrorKind;
  message: string;
  /** Set when the program itself returned an error. */
  program: HoldbackProgramError | null;
}

export function txError(kind: TxErrorKind, message: string): TxError {
  return { kind, message, program: null };
}

const REJECTED = /reject|denied|declin|cancel/i;
const EXPIRED = /block height exceeded|blockhash not found|expired/i;

/** Classifies anything thrown while assessing, simulating, signing or confirming. */
export function toTxError(failure: unknown, fallback: TxErrorKind = 'send_failed'): TxError {
  const program = parseProgramError(failure);
  if (program) return { kind: 'program_error', message: program.message, program };

  const message = errorMessage(failure);
  if (failure instanceof IntegrationUnavailableError) return txError('agent_unavailable', message);
  if (failure instanceof GuardianError) {
    const outage = failure.status >= 500 || failure.status === 429;
    return txError(outage ? 'agent_unavailable' : 'assessment_failed', message);
  }
  const name = failure instanceof Error ? failure.name : '';
  if (name === 'WalletNotConnectedError') return txError('wallet_not_connected', message);
  if (REJECTED.test(message)) return txError('rejected', message);
  if (EXPIRED.test(message) || name === 'TransactionExpiredBlockheightExceededError') {
    return txError('expired', message);
  }
  return txError(fallback, message);
}

/**
 * Has the wallet sign and send a built transaction, then waits until the
 * cluster confirms it. Throws on any failure, including a transaction that
 * landed but failed; pass the result through `toTxError`.
 */
export async function sendAndConfirm(
  connection: Connection,
  wallet: Pick<WalletContextState, 'sendTransaction'>,
  built: BuiltTransaction,
): Promise<string> {
  const signature = await wallet.sendTransaction(built.transaction, connection);
  const result = await connection.confirmTransaction(
    { signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight },
    'confirmed',
  );
  if (result.value.err) {
    // Carries the RPC error object so `parseProgramError` can find a custom code.
    throw Object.assign(new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`), {
      logs: [JSON.stringify(result.value.err)],
    });
  }
  return signature;
}
