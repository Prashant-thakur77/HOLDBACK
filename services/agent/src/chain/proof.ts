/**
 * Proof-by-transfer. A transfer-only wallet cannot sign a message, so it
 * proves control differently: the service names a random amount, and the
 * owner sends exactly that amount from their own token account into their
 * own deposit box. Only the owner's key can authorise that transfer, and
 * the money never leaves their control (the box pays out only to them).
 *
 * `verifyProofTransfer` is pure: it judges an already-fetched transaction.
 */
import type { ParsedTransactionWithMeta } from '@solana/web3.js';

export interface ProofExpectation {
  owner: string;
  mint: string;
  /** Base units. */
  amount: bigint;
  /** The deposit box's token account for `mint`. */
  boxTokenAccount: string;
  /** Unix seconds. */
  createdAt: number;
  expiresAt: number;
}

export type ProofFailure =
  | 'transaction_not_found'
  | 'transaction_failed'
  | 'no_block_time'
  | 'before_challenge'
  | 'after_expiry'
  | 'owner_did_not_sign'
  | 'no_matching_transfer';

interface TransferInfo {
  source?: string;
  destination?: string;
  authority?: string;
  multisigAuthority?: string;
  amount?: string;
  mint?: string;
  tokenAmount?: { amount?: string };
}

interface ParsedIx {
  program?: string;
  parsed?: { type?: string; info?: TransferInfo };
}

/** Top-level and inner instructions, flattened. */
function allInstructions(tx: ParsedTransactionWithMeta): ParsedIx[] {
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions);
  return [...tx.transaction.message.instructions, ...inner] as ParsedIx[];
}

/** Owner and mint of a token account, from the transaction's own balance records. */
function tokenAccountInfo(
  tx: ParsedTransactionWithMeta,
  address: string,
): { owner?: string; mint: string } | null {
  const keys = tx.transaction.message.accountKeys.map((key) => key.pubkey.toBase58());
  const balances = [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])];
  const balance = balances.find((entry) => keys[entry.accountIndex] === address);
  return balance ? { owner: balance.owner, mint: balance.mint } : null;
}

/**
 * Returns `null` when `tx` proves the challenge, otherwise why it does not.
 * All of these must hold:
 * - the transaction succeeded, and its block time lies inside the
 *   challenge window (not before it was created, not after it expired);
 * - the owner signed it;
 * - it contains an SPL token transfer of exactly the challenge amount,
 *   authorised by the owner, from a token account the owner owns, into the
 *   owner's deposit-box token account, in the challenge's mint.
 */
export function verifyProofTransfer(
  tx: ParsedTransactionWithMeta | null,
  expected: ProofExpectation,
): ProofFailure | null {
  if (!tx) return 'transaction_not_found';
  if (!tx.meta || tx.meta.err !== null) return 'transaction_failed';
  if (typeof tx.blockTime !== 'number') return 'no_block_time';
  if (tx.blockTime < expected.createdAt) return 'before_challenge';
  if (tx.blockTime > expected.expiresAt) return 'after_expiry';

  const ownerSigned = tx.transaction.message.accountKeys.some(
    (key) => key.signer && key.pubkey.toBase58() === expected.owner,
  );
  if (!ownerSigned) return 'owner_did_not_sign';

  const proves = allInstructions(tx).some((instruction) => {
    const type = instruction.parsed?.type;
    const info = instruction.parsed?.info;
    if (instruction.program !== 'spl-token' || !info) return false;
    if (type !== 'transfer' && type !== 'transferChecked') return false;
    if (info.destination !== expected.boxTokenAccount) return false;
    if ((info.authority ?? info.multisigAuthority) !== expected.owner) return false;
    const amount = info.amount ?? info.tokenAmount?.amount;
    if (amount === undefined || BigInt(amount) !== expected.amount) return false;
    if (!info.source) return false;
    const source = tokenAccountInfo(tx, info.source);
    const destination = tokenAccountInfo(tx, info.destination);
    return (
      source?.owner === expected.owner &&
      source.mint === expected.mint &&
      destination?.mint === expected.mint
    );
  });
  return proves ? null : 'no_matching_transfer';
}
