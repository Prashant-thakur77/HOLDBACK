/**
 * Transaction assembly: versioned transactions with a priority fee, the
 * one-call `buildCreateHoldTx`, and a simulate-before-sign preview.
 */
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';

import { PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from './constants';
import { assessmentMessage, attestationInstruction, type Attestation } from './attestation';
import { fromHex, toHex } from './evidence';
import {
  createHold,
  createHoldAttested,
  createHoldSol,
  createHoldSolAttested,
  instantTransfer,
  instantTransferSol,
} from './instructions';
import { associatedTokenAddress, holdPda } from './pdas';

export interface MintInfo {
  tokenProgram: PublicKey;
  decimals: number;
}

/** Reads a mint's owning token program and decimals. */
export async function getMintInfo(connection: Connection, mint: PublicKey): Promise<MintInfo> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint ${mint.toBase58()} does not exist on this cluster`);
  const isToken = info.owner.equals(TOKEN_PROGRAM_ID);
  if (!isToken && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(`${mint.toBase58()} is not a token mint`);
  }
  if (info.data.length < 45) throw new Error(`${mint.toBase58()} has no mint data`);
  return { tokenProgram: info.owner, decimals: info.data[44]! };
}

/**
 * A nonce that is unique per sender without reading the chain: milliseconds
 * since the epoch in the high bits, 20 random bits below.
 */
export function newNonce(): bigint {
  const random = BigInt(Math.floor(Math.random() * 0x100000));
  return (BigInt(Date.now()) << 20n) | random;
}

export interface BuildOptions {
  /**
   * Priority fee in micro-lamports per compute unit. `'auto'` (default) uses
   * the median of recent fees for the accounts involved, clamped to a sane
   * range; `0` omits the instruction.
   */
  priorityFee?: number | 'auto';
  /** Compute unit limit. Defaults to 120,000, enough for every instruction. */
  computeUnits?: number;
}

export interface BuiltTransaction {
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}

const MIN_AUTO_FEE = 1_000;
const MAX_AUTO_FEE = 250_000;

async function resolvePriorityFee(
  connection: Connection,
  instructions: TransactionInstruction[],
  option: number | 'auto',
): Promise<number> {
  if (option !== 'auto') return option;
  try {
    const writable = instructions
      .flatMap((ix) => ix.keys)
      .filter((key) => key.isWritable)
      .map((key) => key.pubkey)
      .slice(0, 16);
    const fees = (
      await connection.getRecentPrioritizationFees({ lockedWritableAccounts: writable })
    )
      .map((entry) => entry.prioritizationFee)
      .sort((a, b) => a - b);
    const median = fees[Math.floor(fees.length / 2)] ?? 0;
    return Math.min(MAX_AUTO_FEE, Math.max(MIN_AUTO_FEE, median));
  } catch {
    return MIN_AUTO_FEE;
  }
}

/** Wraps instructions in an unsigned v0 transaction with compute budget set. */
export async function buildTransaction(
  connection: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
  options: BuildOptions = {},
): Promise<BuiltTransaction> {
  const fee = await resolvePriorityFee(connection, instructions, options.priorityFee ?? 'auto');
  const budget = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: options.computeUnits ?? 120_000 }),
  ];
  if (fee > 0) budget.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fee }));

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [...budget, ...instructions],
  }).compileToV0Message();
  return { transaction: new VersionedTransaction(message), blockhash, lastValidBlockHeight };
}

export interface CreateHoldParams extends BuildOptions {
  sender: PublicKey;
  recipient: PublicKey;
  /** Token mint, or `null` for native SOL. */
  mint: PublicKey | null;
  /** Base units. */
  amount: bigint;
  /** `0` uses the instant path and needs the sender's trust in the recipient. */
  windowSecs: number;
  tier: number;
  evidenceHash: Uint8Array;
  nonce?: bigint;
  programId?: PublicKey;
  /**
   * The Guardian's signed assessment. When present the hold is created with
   * `create_hold_attested`, so the program checks that the risk oracle set
   * this window, tier and evidence hash. `windowSecs` may exceed the signed
   * window, never fall below it.
   */
  attestation?: Attestation;
}

export interface CreateHoldResult extends BuiltTransaction {
  /** The new hold's address, or `null` for an instant transfer. */
  hold: PublicKey | null;
  nonce: bigint;
  instant: boolean;
}

/**
 * Builds the transaction for a protected payment. It looks up the mint's
 * token program, chooses between a hold and an instant transfer from
 * `windowSecs`, and adds a priority fee. The sender signs the result.
 */
export async function buildCreateHoldTx(
  connection: Connection,
  params: CreateHoldParams,
): Promise<CreateHoldResult> {
  const programId = params.programId ?? PROGRAM_ID;
  const nonce = params.nonce ?? newNonce();
  const instant = params.windowSecs === 0;
  const { sender, recipient, amount } = params;

  if (params.attestation && !instant) {
    const attested = await attestedInstructions(connection, params, nonce, programId);
    const built = await buildTransaction(connection, sender, attested, params);
    return { ...built, hold: holdPda(sender, nonce, programId), nonce, instant };
  }

  let instruction: TransactionInstruction;
  if (params.mint === null) {
    instruction = instant
      ? instantTransferSol({ sender, recipient, amount, programId })
      : createHoldSol({ ...params, nonce, programId });
  } else {
    const { tokenProgram } = await getMintInfo(connection, params.mint);
    instruction = instant
      ? instantTransfer({ sender, recipient, amount, mint: params.mint, tokenProgram, programId })
      : createHold({ ...params, mint: params.mint, tokenProgram, nonce, programId });
  }

  const built = await buildTransaction(connection, sender, [instruction], params);
  return { ...built, hold: instant ? null : holdPda(sender, nonce, programId), nonce, instant };
}

/** The Ed25519 verification and the attested hold instruction, in that order. */
async function attestedInstructions(
  connection: Connection,
  params: CreateHoldParams,
  nonce: bigint,
  programId: PublicKey,
): Promise<TransactionInstruction[]> {
  const attestation = params.attestation!;
  const evidenceHash = fromHex(attestation.evidenceHash);
  if (toHex(params.evidenceHash) !== attestation.evidenceHash.toLowerCase()) {
    throw new Error('The evidence hash does not match the signed assessment');
  }
  const message = assessmentMessage(
    {
      sender: params.sender,
      recipient: params.recipient,
      mint: params.mint,
      amount: params.amount,
      windowSecs: attestation.windowSecs,
      tier: attestation.tier,
      evidenceHash,
      expiresAt: attestation.expiresAt,
    },
    programId,
  );
  const verify = attestationInstruction(
    new PublicKey(attestation.oracle),
    fromHex(attestation.signature),
    message,
  );
  const common = {
    sender: params.sender,
    recipient: params.recipient,
    nonce,
    amount: params.amount,
    windowSecs: Math.max(params.windowSecs, attestation.windowSecs),
    attestedWindowSecs: attestation.windowSecs,
    tier: attestation.tier,
    evidenceHash,
    expiresAt: attestation.expiresAt,
    programId,
  };
  if (params.mint === null) return [verify, createHoldSolAttested(common)];
  const { tokenProgram } = await getMintInfo(connection, params.mint);
  return [verify, createHoldAttested({ ...common, mint: params.mint, tokenProgram })];
}

export interface BalanceChange {
  owner: PublicKey;
  /** `null` for SOL. */
  mint: PublicKey | null;
  /** Base units before and after; `delta = after - before`. */
  before: bigint;
  after: bigint;
  delta: bigint;
}

export interface Preview {
  ok: boolean;
  /** Program logs from the simulation. */
  logs: string[];
  /** Raw RPC error when the simulation failed. */
  error: unknown;
  changes: BalanceChange[];
  unitsConsumed: number | null;
}

function tokenAmount(data: Uint8Array | null | undefined): bigint {
  if (!data || data.length < 72) return 0n;
  let value = 0n;
  for (let i = 71; i >= 64; i--) value = (value << 8n) | BigInt(data[i]!);
  return value;
}

/**
 * Simulates a transaction without signatures and reports how the watched
 * balances would change. This is what the app shows on the pre-sign card:
 * the user sees what leaves their wallet before any signature exists.
 */
export async function previewTransaction(
  connection: Connection,
  transaction: VersionedTransaction,
  watch: { owner: PublicKey; mint: PublicKey | null; tokenProgram?: PublicKey }[],
): Promise<Preview> {
  const addresses = watch.map(({ owner, mint, tokenProgram }) =>
    mint ? associatedTokenAddress(owner, mint, tokenProgram ?? TOKEN_PROGRAM_ID) : owner,
  );
  const before = await connection.getMultipleAccountsInfo(addresses, 'confirmed');
  const result = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses: addresses.map((address) => address.toBase58()) },
  });

  const after = result.value.accounts ?? [];
  const changes = watch.map(({ owner, mint }, i): BalanceChange => {
    const pre = before[i];
    const post = after[i];
    const encoded = post?.data[0];
    const postData = encoded ? Uint8Array.from(Buffer.from(encoded, 'base64')) : null;
    const was = mint ? tokenAmount(pre?.data) : BigInt(pre?.lamports ?? 0);
    const now = mint ? tokenAmount(postData) : BigInt(post?.lamports ?? 0);
    return { owner, mint, before: was, after: now, delta: now - was };
  });

  return {
    ok: result.value.err === null,
    logs: result.value.logs ?? [],
    error: result.value.err,
    changes,
    unitsConsumed: result.value.unitsConsumed ?? null,
  };
}
