import { parseProgramError, type BuiltTransaction } from '@holdback/sdk';
import type { PublicKey } from '@solana/web3.js';

import type { ServerDeps } from './context';
import { ToolError } from './errors';

export interface Submission {
  status: 'sent' | 'needs_signature' | 'no_change';
  signature: string | null;
  unsignedTransaction: string | null;
  requiredSigner: string;
  lastValidBlockHeight: number | null;
}

/** The result of a write tool that found the chain already in the requested state. */
export function noChange(actor: PublicKey): Submission {
  return {
    status: 'no_change',
    signature: null,
    unsignedTransaction: null,
    requiredSigner: actor.toBase58(),
    lastValidBlockHeight: null,
  };
}

function sendError(failure: unknown, signature: string | null): ToolError {
  const program = parseProgramError(failure);
  const details = signature ? { signature } : {};
  if (program) {
    return new ToolError('program_refused', `${program.name}: ${program.message}`, details);
  }
  const message = failure instanceof Error ? failure.message : String(failure);
  return new ToolError(
    signature ? 'confirmation_failed' : 'send_failed',
    signature
      ? `The transaction was sent but not confirmed (${message}). Check the signature before retrying.`
      : `The transaction could not be sent: ${message}`,
    details,
  );
}

/**
 * The one rule every write tool follows. With a configured keypair the
 * transaction is signed, sent and confirmed here. Without one nothing is
 * sent: the caller gets the unsigned transaction for its own wallet to sign,
 * so this server never needs custody to be useful.
 */
export async function submit(
  deps: ServerDeps,
  built: BuiltTransaction,
  actor: PublicKey,
): Promise<Submission> {
  const base = {
    requiredSigner: actor.toBase58(),
    lastValidBlockHeight: built.lastValidBlockHeight,
  };
  if (!deps.signer) {
    return {
      ...base,
      status: 'needs_signature',
      signature: null,
      unsignedTransaction: Buffer.from(built.transaction.serialize()).toString('base64'),
    };
  }

  built.transaction.sign([deps.signer]);
  let signature: string | null = null;
  try {
    signature = await deps.connection.sendTransaction(built.transaction, { maxRetries: 3 });
    const confirmation = await deps.connection.confirmTransaction(
      {
        signature,
        blockhash: built.blockhash,
        lastValidBlockHeight: built.lastValidBlockHeight,
      },
      'confirmed',
    );
    if (confirmation.value.err) throw confirmation.value.err;
  } catch (failure) {
    throw sendError(failure, signature);
  }
  return { ...base, status: 'sent', signature, unsignedTransaction: null };
}
