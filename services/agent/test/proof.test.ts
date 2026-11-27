import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, type ParsedTransactionWithMeta } from '@solana/web3.js';

import { verifyProofTransfer, type ProofExpectation } from '../src/chain/proof';

const key = () => Keypair.generate().publicKey;

const OWNER = key();
const SPONSOR = key();
const STRANGER = key();
const MINT = key();
const OTHER_MINT = key();
const OWNER_TOKEN = key();
const STRANGER_TOKEN = key();
const BOX = key();
const BOX_TOKEN = key();
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const CREATED = 1_790_000_000;
const EXPIRES = CREATED + 900;

const expected: ProofExpectation = {
  owner: OWNER.toBase58(),
  mint: MINT.toBase58(),
  amount: 54_321n,
  boxTokenAccount: BOX_TOKEN.toBase58(),
  createdAt: CREATED,
  expiresAt: EXPIRES,
};

interface Options {
  blockTime?: number | null;
  failed?: boolean;
  amount?: string;
  authority?: PublicKey;
  source?: PublicKey;
  sourceOwner?: PublicKey;
  destination?: PublicKey;
  mint?: PublicKey;
  ownerSigns?: boolean;
  checked?: boolean;
  inner?: boolean;
  program?: string;
}

/** A parsed transfer transaction as the RPC returns it, with a fee sponsor as payer. */
function transferTx(options: Options = {}): ParsedTransactionWithMeta {
  const source = options.source ?? OWNER_TOKEN;
  const destination = options.destination ?? BOX_TOKEN;
  const mint = (options.mint ?? MINT).toBase58();
  const amount = options.amount ?? '54321';
  const authority = (options.authority ?? OWNER).toBase58();
  const accountKeys = [
    { pubkey: SPONSOR, signer: true, writable: true },
    { pubkey: options.authority ?? OWNER, signer: options.ownerSigns ?? true, writable: false },
    { pubkey: source, signer: false, writable: true },
    { pubkey: destination, signer: false, writable: true },
    { pubkey: TOKEN_PROGRAM, signer: false, writable: false },
  ];
  const instruction = {
    program: options.program ?? 'spl-token',
    programId: TOKEN_PROGRAM,
    parsed: options.checked
      ? {
          type: 'transferChecked',
          info: {
            source: source.toBase58(),
            destination: destination.toBase58(),
            authority,
            mint,
            tokenAmount: { amount, decimals: 6, uiAmount: 0.054321, uiAmountString: '0.054321' },
          },
        }
      : {
          type: 'transfer',
          info: {
            source: source.toBase58(),
            destination: destination.toBase58(),
            authority,
            amount,
          },
        },
  };
  const balance = (accountIndex: number, owner: PublicKey, raw: string) => ({
    accountIndex,
    mint,
    owner: owner.toBase58(),
    uiTokenAmount: { amount: raw, decimals: 6, uiAmount: null, uiAmountString: raw },
  });
  return {
    slot: 1,
    blockTime: options.blockTime === undefined ? CREATED + 60 : options.blockTime,
    transaction: {
      signatures: ['sig'],
      message: {
        accountKeys,
        instructions: options.inner ? [] : [instruction],
        recentBlockhash: '11111111111111111111111111111111',
      },
    },
    meta: {
      err: options.failed ? { InstructionError: [0, 'Custom'] } : null,
      fee: 5_000,
      preBalances: [],
      postBalances: [],
      innerInstructions: options.inner ? [{ index: 0, instructions: [instruction] }] : [],
      preTokenBalances: [balance(2, options.sourceOwner ?? OWNER, '1000000'), balance(3, BOX, '0')],
      postTokenBalances: [
        balance(2, options.sourceOwner ?? OWNER, '945679'),
        balance(3, BOX, '54321'),
      ],
    },
  } as unknown as ParsedTransactionWithMeta;
}

describe('proof by transfer', () => {
  it('accepts the exact transfer from the owner into their box', () => {
    expect(verifyProofTransfer(transferTx(), expected)).toBeNull();
  });

  it('accepts transferChecked and transfers made inside another instruction', () => {
    expect(verifyProofTransfer(transferTx({ checked: true }), expected)).toBeNull();
    expect(verifyProofTransfer(transferTx({ inner: true }), expected)).toBeNull();
  });

  it('accepts a transaction whose fee was paid by someone else', () => {
    const tx = transferTx();
    expect(tx.transaction.message.accountKeys[0]!.pubkey.equals(SPONSOR)).toBe(true);
    expect(verifyProofTransfer(tx, expected)).toBeNull();
  });

  it('rejects a missing or failed transaction', () => {
    expect(verifyProofTransfer(null, expected)).toBe('transaction_not_found');
    expect(verifyProofTransfer(transferTx({ failed: true }), expected)).toBe('transaction_failed');
  });

  it('rejects a transfer made before the challenge existed', () => {
    expect(verifyProofTransfer(transferTx({ blockTime: CREATED - 1 }), expected)).toBe(
      'before_challenge',
    );
    expect(verifyProofTransfer(transferTx({ blockTime: CREATED }), expected)).toBeNull();
  });

  it('rejects a transfer made after the challenge expired', () => {
    expect(verifyProofTransfer(transferTx({ blockTime: EXPIRES + 1 }), expected)).toBe(
      'after_expiry',
    );
    expect(verifyProofTransfer(transferTx({ blockTime: EXPIRES }), expected)).toBeNull();
    expect(verifyProofTransfer(transferTx({ blockTime: null }), expected)).toBe('no_block_time');
  });

  it('rejects any amount other than the challenge amount', () => {
    for (const amount of ['54320', '54322', '543210', '0']) {
      expect(verifyProofTransfer(transferTx({ amount }), expected), amount).toBe(
        'no_matching_transfer',
      );
    }
  });

  it('rejects a transfer someone else made into the box', () => {
    const fromStranger = transferTx({
      authority: STRANGER,
      source: STRANGER_TOKEN,
      sourceOwner: STRANGER,
    });
    // The owner is not even a signer here.
    expect(verifyProofTransfer(fromStranger, expected)).toBe('owner_did_not_sign');
  });

  it('rejects a transfer the owner did not sign', () => {
    expect(verifyProofTransfer(transferTx({ ownerSigns: false }), expected)).toBe(
      'owner_did_not_sign',
    );
  });

  it('rejects a transfer from a token account the owner does not own', () => {
    const tx = transferTx({ source: STRANGER_TOKEN, sourceOwner: STRANGER });
    expect(verifyProofTransfer(tx, expected)).toBe('no_matching_transfer');
  });

  it('rejects a transfer to any account other than the box token account', () => {
    expect(verifyProofTransfer(transferTx({ destination: STRANGER_TOKEN }), expected)).toBe(
      'no_matching_transfer',
    );
  });

  it('rejects a transfer of a different token', () => {
    expect(verifyProofTransfer(transferTx({ mint: OTHER_MINT }), expected)).toBe(
      'no_matching_transfer',
    );
    expect(verifyProofTransfer(transferTx({ mint: OTHER_MINT, checked: true }), expected)).toBe(
      'no_matching_transfer',
    );
  });

  it('rejects a look-alike instruction from another program', () => {
    expect(verifyProofTransfer(transferTx({ program: 'system' }), expected)).toBe(
      'no_matching_transfer',
    );
  });
});
