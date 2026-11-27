/**
 * The relayer: acts for wallets that can only make transfers. Such a
 * wallet pays into its own deposit box; this key then opens holds from the
 * box, undoes them, or withdraws, always on the owner's authenticated
 * request.
 *
 * What the program lets this key do is narrow: a hold opened from a box
 * always has the box owner as its sender and at least the default window;
 * an undo or a withdrawal can only pay the owner. The key can never choose
 * where an owner's money goes other than "to the recipient the owner
 * named, after the window" or "back to the owner".
 */
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import {
  HoldOrigin,
  HoldStatus,
  associatedTokenAddress,
  depositBoxPda,
  fetchDepositBox,
  fetchHold,
  fromHex,
  holdPda,
  instructions,
  newNonce,
  type AssessResponse,
  type RelayOpenRequest,
  type RelayOpenResponse,
} from '@holdback/sdk';

import { assess } from '../assess';
import { createdEvent, ingestEvents } from '../db/holds';
import { badRequest, forbidden } from '../errors';
import { requireKeypair } from '../lib/keys';
import { stablecoinUsd } from '../lib/pricing';
import { createAtaIdempotent, parsePubkey, sendAndConfirm } from '../lib/solana';
import { windowLimits, type Services } from '../services';
import { mintInfo, requireHold } from './holds';

export interface BoxAddresses {
  depositBox: PublicKey;
  boxTokenAccount: PublicKey;
  tokenProgram: PublicKey;
}

export async function boxAddresses(
  services: Services,
  owner: PublicKey,
  mint: PublicKey,
): Promise<BoxAddresses> {
  const { tokenProgram } = await mintInfo(services, mint);
  const depositBox = depositBoxPda(owner, services.programId);
  return {
    depositBox,
    boxTokenAccount: associatedTokenAddress(depositBox, mint, tokenProgram),
    tokenProgram,
  };
}

/** Base units of `mint` the wallet holds across its token accounts. */
export async function tokenBalance(
  services: Services,
  owner: PublicKey,
  mint: PublicKey,
): Promise<bigint> {
  const { value } = await services.cluster.getTokenAccountsByOwner(owner, { mint });
  return value
    .filter(({ account }) => account.data.length >= 72)
    .reduce(
      (sum, { account }) =>
        sum +
        new DataView(
          account.data.buffer,
          account.data.byteOffset,
          account.data.byteLength,
        ).getBigUint64(64, true),
      0n,
    );
}

/**
 * Makes sure the owner's deposit box and its token account for `mint`
 * exist, creating whichever is missing with the relayer paying the rent.
 */
export async function ensureDepositBox(
  services: Services,
  owner: PublicKey,
  mint: PublicKey,
): Promise<BoxAddresses> {
  const addresses = await boxAddresses(services, owner, mint);
  const { cluster, programId } = services;
  const [box, tokenAccount] = await Promise.all([
    fetchDepositBox(cluster, owner, { programId }),
    cluster.getAccountInfo(addresses.boxTokenAccount),
  ]);
  if (box && tokenAccount) return addresses;

  const relayer = requireKeypair(services.env, 'RELAYER_KEYPAIR');
  const instruction = box
    ? // The box exists from another token; it only needs a token account for this one.
      createAtaIdempotent(
        relayer.publicKey,
        addresses.boxTokenAccount,
        addresses.depositBox,
        mint,
        addresses.tokenProgram,
      )
    : instructions.initDepositBox({
        payer: relayer.publicKey,
        owner,
        mint,
        tokenProgram: addresses.tokenProgram,
        programId,
      });
  await sendAndConfirm(cluster, relayer, [instruction]);
  return addresses;
}

/**
 * The window a relayed hold gets: the policy's window, raised to the
 * program's floor for relayed holds and to the owner's request if that is
 * longer, and capped at the program's maximum. It is never below policy.
 */
export function relayWindowSecs(
  policyWindowSecs: number,
  requestedSecs: number | undefined,
  limits: { defaultWindowSecs: number; maxWindowSecs: number },
): number {
  const wanted = Math.max(policyWindowSecs, limits.defaultWindowSecs, requestedSecs ?? 0);
  return Math.min(wanted, limits.maxWindowSecs);
}

/** Assesses the recipient, then opens a hold from the owner's deposit box. */
export async function relayOpen(
  services: Services,
  ownerAddress: string,
  request: RelayOpenRequest,
): Promise<RelayOpenResponse> {
  const owner = parsePubkey(ownerAddress, 'owner');
  const recipient = parsePubkey(request.recipient, 'recipient');
  const mint = parsePubkey(request.mint, 'mint');
  const amount = BigInt(request.amount);
  if (recipient.equals(owner)) throw badRequest('You cannot pay yourself', 'self_transfer');

  const assessment: AssessResponse = await assess(services, {
    sender: ownerAddress,
    recipient: request.recipient,
    mint: request.mint,
    amount,
    context: request.context,
    lang: request.lang,
  });
  if (assessment.requiresConfirmation) {
    // A sanctioned recipient needs a typed confirmation from the user, which
    // a relayed request cannot carry.
    throw forbidden(
      'This recipient is on a sanctions list. HOLDBACK will not relay this payment.',
      'sanctioned_recipient',
    );
  }

  const windowSecs = relayWindowSecs(
    assessment.windowSecs,
    request.windowSecs,
    await windowLimits(services),
  );
  const relayer = requireKeypair(services.env, 'RELAYER_KEYPAIR');
  const { tokenProgram } = await mintInfo(services, mint);
  const nonce = newNonce();
  const hold = holdPda(owner, nonce, services.programId);
  const signature = await sendAndConfirm(
    services.cluster,
    relayer,
    [
      instructions.openHoldFromDeposit({
        relayer: relayer.publicKey,
        owner,
        recipient,
        mint,
        tokenProgram,
        nonce,
        amount,
        windowSecs,
        tier: assessment.tierIndex,
        evidenceHash: fromHex(assessment.evidenceHash),
        programId: services.programId,
      }),
    ],
    { computeUnits: 200_000 },
  );

  const { db, cluster, programId } = services;
  if (db) {
    // Mirror the hold from the chain's own values, so it shows up at once
    // even if the webhook is slow. The webhook's copy is then a no-op.
    services.background.waitUntil(
      fetchHold(cluster, hold, { programId })
        .then((created) =>
          created
            ? ingestEvents(db, [
                createdEvent(created, signature, stablecoinUsd(request.mint, amount)),
              ])
            : [],
        )
        .catch(() => undefined),
    );
  }
  return { hold: hold.toBase58(), signature, assessment };
}

/** Undoes a deposit-box hold. The refund can only go to the owner's own token account. */
export async function relayReclaim(
  services: Services,
  ownerAddress: string,
  holdAddress: string,
): Promise<string> {
  const hold = await requireHold(services, parsePubkey(holdAddress, 'hold'));
  if (hold.sender.toBase58() !== ownerAddress || hold.origin !== HoldOrigin.DEPOSIT_BOX) {
    throw forbidden('This hold was not opened from your deposit box');
  }
  if (hold.status !== HoldStatus.PENDING) {
    throw badRequest('This hold is no longer pending', 'hold_not_pending');
  }
  const relayer = requireKeypair(services.env, 'RELAYER_KEYPAIR');
  const { tokenProgram } = await mintInfo(services, hold.mint);
  const steps: TransactionInstruction[] = [
    // The owner may have closed their token account since paying in.
    createAtaIdempotent(
      relayer.publicKey,
      associatedTokenAddress(hold.sender, hold.mint, tokenProgram),
      hold.sender,
      hold.mint,
      tokenProgram,
    ),
    instructions.reclaim({
      authority: relayer.publicKey,
      hold,
      tokenProgram,
      programId: services.programId,
    }),
  ];
  const signature = await sendAndConfirm(services.cluster, relayer, steps);
  if (services.db) {
    services.background.waitUntil(
      ingestEvents(services.db, [
        {
          kind: 'hold_settled',
          signature,
          pda: holdAddress,
          status: HoldStatus.RECLAIMED,
          settled_at: Math.floor(Date.now() / 1000),
        },
      ]).catch(() => undefined),
    );
  }
  return signature;
}

/** Returns money from the deposit box to the owner's own token account. */
export async function relayWithdraw(
  services: Services,
  ownerAddress: string,
  mintAddress: string,
  amount: bigint,
): Promise<string> {
  const owner = parsePubkey(ownerAddress, 'owner');
  const mint = parsePubkey(mintAddress, 'mint');
  const relayer = requireKeypair(services.env, 'RELAYER_KEYPAIR');
  const { tokenProgram } = await mintInfo(services, mint);
  return sendAndConfirm(services.cluster, relayer, [
    createAtaIdempotent(
      relayer.publicKey,
      associatedTokenAddress(owner, mint, tokenProgram),
      owner,
      mint,
      tokenProgram,
    ),
    instructions.withdrawDeposit({
      authority: relayer.publicKey,
      owner,
      mint,
      tokenProgram,
      amount,
      programId: services.programId,
    }),
  ]);
}
