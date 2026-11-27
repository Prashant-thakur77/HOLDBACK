/** Writes a Scam Dojo run result on-chain as a memo, signed by the crank key. */
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

import { utf8 } from '../lib/encoding';
import { requireKeypair } from '../lib/keys';
import { sendAndConfirm } from '../lib/solana';
import type { Services } from '../services';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export const dojoMemo = (runId: string, score: number, historyHash: string) =>
  `holdback-dojo:${runId}:${score}:${historyHash}`;

export async function writeMemo(services: Services, memo: string): Promise<string> {
  const crank = requireKeypair(services.env, 'CRANK_KEYPAIR');
  return sendAndConfirm(services.cluster, crank, [
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: crank.publicKey, isSigner: true, isWritable: false }],
      data: Buffer.from(utf8(memo)),
    }),
  ]);
}
