/**
 * Connections and a confirm loop that works on Workers. `Connection`'s own
 * confirmation uses a WebSocket subscription; here every step is plain
 * HTTP so it runs inside a request or a cron invocation.
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type Keypair,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PROGRAM_ID,
  buildTransaction,
  parseProgramError,
} from '@holdback/sdk';

import type { Env } from '../env';
import { ApiError, badRequest } from '../errors';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

/** `Connection` bound to the global `fetch`, so tests can replace it. */
function connect(url: string): Connection {
  return new Connection(url, {
    commitment: 'confirmed',
    fetch: (input, init) => fetch(input as RequestInfo, init as RequestInit),
  });
}

/** The cluster the HOLDBACK program is deployed on. */
export function clusterConnection(env: Env): Connection {
  return connect(env.SOLANA_RPC_URL || DEVNET_RPC);
}

export function mainnetRpcUrl(env: Env): string {
  if (env.MAINNET_RPC_URL) return env.MAINNET_RPC_URL;
  if (env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
  return MAINNET_RPC;
}

/** Mainnet, where long-lived wallet history, names and Seeker tokens live. */
export function mainnetConnection(env: Env): Connection {
  return connect(mainnetRpcUrl(env));
}

export function programId(env: Env): PublicKey {
  return env.PROGRAM_ID ? new PublicKey(env.PROGRAM_ID) : PROGRAM_ID;
}

/** Parses a base58 public key from user input, or throws a 400. */
export function parsePubkey(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw badRequest(`${field} is not a valid Solana address`);
  }
}

export function isPubkey(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

/** Creates the associated token account if it is missing; a no-op otherwise. */
export function createAtaIdempotent(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    // Instruction 1 of the associated-token program: CreateIdempotent.
    data: Buffer.from([1]),
  });
}

const CONFIRM_POLL_MS = 800;
const CONFIRM_TIMEOUT_MS = 25_000;

/**
 * Signs with `payer`, sends and waits for `confirmed`. A program error
 * surfaces as a 409 with the program's own message.
 */
export async function sendAndConfirm(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  options: { computeUnits?: number } = {},
): Promise<string> {
  const { transaction, lastValidBlockHeight } = await buildTransaction(
    connection,
    payer.publicKey,
    instructions,
    { computeUnits: options.computeUnits },
  );
  transaction.sign([payer]);

  let signature: string;
  try {
    signature = await connection.sendRawTransaction(transaction.serialize(), { maxRetries: 3 });
  } catch (error) {
    throw toApiError(error);
  }

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) throw toApiError(status.err);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return signature;
    }
    if ((await connection.getBlockHeight('confirmed')) > lastValidBlockHeight) break;
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
  }
  throw new ApiError(504, 'not_confirmed', `Transaction ${signature} was not confirmed in time`);
}

function toApiError(failure: unknown): ApiError {
  const known = parseProgramError(failure);
  if (known) return new ApiError(409, `program_${known.name}`, known.message);
  const message = failure instanceof Error ? failure.message : JSON.stringify(failure);
  return new ApiError(502, 'transaction_failed', message.slice(0, 300));
}
