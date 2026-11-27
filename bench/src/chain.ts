/**
 * Time from sending `create_hold` and `reclaim` to their confirmation on
 * devnet, using the SDK's instruction builders.
 *
 * A throwaway keypair is funded from the deployer key with a fixed, small
 * amount, opens and undoes a few SOL holds, closes them to get the rent
 * back, and returns what is left. Key material is never printed or written.
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { PROGRAM_ID, fetchHold, holdPda, instructions, newNonce } from '@holdback/sdk';

import { summarise, type LatencySummary } from './stats';

/** Hard ceiling on what may leave the deployer key for one run. */
export const MAX_FUNDING_LAMPORTS = 0.2 * LAMPORTS_PER_SOL;
const FUNDING_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;
/** Above the rent-exempt minimum the program requires for a SOL hold. */
const HOLD_LAMPORTS = 2_000_000n;
const WINDOW_SECS = 1_800;
const UNKNOWN_TIER = 1;
const BASE_FEE_LAMPORTS = 5_000;
/**
 * Waited between transactions and never timed. A public RPC endpoint answers
 * a burst with HTTP 429, and the client library's retries would otherwise be
 * counted as confirmation time.
 */
const PAUSE_MS = 2_500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type ChainBench =
  | { available: false; reason: string }
  | {
      available: true;
      cluster_rpc_host: string;
      program_id: string;
      commitment: 'confirmed';
      iterations: number;
      create_hold: LatencySummary;
      reclaim: LatencySummary;
      funded_lamports: number;
      returned_lamports: number;
      signatures: { create_hold: string[]; reclaim: string[] };
      note: string;
    };

/** Signs, sends and waits for `confirmed`. Returns the signature and the milliseconds from send to confirmation. */
async function sendTimed(
  connection: Connection,
  payer: Keypair,
  instruction: TransactionInstruction,
): Promise<{ signature: string; ms: number }> {
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ feePayer: payer.publicKey, ...latest }).add(instruction);
  transaction.sign(payer);
  const raw = transaction.serialize();
  const started = performance.now();
  const signature = await connection.sendRawTransaction(raw);
  const result = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  const ms = performance.now() - started;
  if (result.value.err) throw new Error('transaction failed on-chain');
  return { signature, ms };
}

function readFunder(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]));
}

async function returnLeftover(
  connection: Connection,
  from: Keypair,
  to: PublicKey,
): Promise<number> {
  const left = await connection.getBalance(from.publicKey, 'confirmed');
  if (left <= BASE_FEE_LAMPORTS) return 0;
  const lamports = left - BASE_FEE_LAMPORTS;
  await sendTimed(
    connection,
    from,
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }),
  );
  return lamports;
}

export async function benchChain(options: {
  rpcUrl: string;
  funderPath: string;
  iterations: number;
  programId?: PublicKey;
}): Promise<ChainBench> {
  const { rpcUrl, funderPath, iterations } = options;
  const programId = options.programId ?? PROGRAM_ID;
  if (!existsSync(funderPath)) {
    return { available: false, reason: 'no funded keypair at keys/deployer.json' };
  }
  if (FUNDING_LAMPORTS > MAX_FUNDING_LAMPORTS) throw new Error('funding exceeds the ceiling');

  const connection = new Connection(rpcUrl, 'confirmed');
  const funder = readFunder(funderPath);
  try {
    if ((await connection.getBalance(funder.publicKey)) < FUNDING_LAMPORTS + BASE_FEE_LAMPORTS) {
      return { available: false, reason: 'the funding key does not hold enough devnet SOL' };
    }
    if (!(await connection.getAccountInfo(programId))?.executable) {
      return { available: false, reason: 'the program is not deployed on this cluster' };
    }
  } catch {
    return { available: false, reason: 'the devnet RPC endpoint could not be reached' };
  }

  const sender = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  await sendTimed(
    connection,
    funder,
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: sender.publicKey,
      lamports: FUNDING_LAMPORTS,
    }),
  );

  const createMs: number[] = [];
  const reclaimMs: number[] = [];
  const signatures = { create_hold: [] as string[], reclaim: [] as string[] };
  let returned = 0;
  try {
    for (let i = 0; i < iterations; i++) {
      const nonce = newNonce();
      const created = await sendTimed(
        connection,
        sender,
        instructions.createHoldSol({
          sender: sender.publicKey,
          recipient,
          nonce,
          amount: HOLD_LAMPORTS,
          windowSecs: WINDOW_SECS,
          tier: UNKNOWN_TIER,
          // The benchmark times the chain, not the Guardian: an all-zero hash stands in.
          evidenceHash: new Uint8Array(32),
          programId,
        }),
      );
      createMs.push(created.ms);
      signatures.create_hold.push(created.signature);
      await sleep(PAUSE_MS);

      const hold = await fetchHold(connection, holdPda(sender.publicKey, nonce, programId), {
        programId,
      });
      if (!hold) throw new Error('the hold was not found after confirmation');
      const undone = await sendTimed(
        connection,
        sender,
        instructions.reclaim({ authority: sender.publicKey, hold, programId }),
      );
      reclaimMs.push(undone.ms);
      signatures.reclaim.push(undone.signature);
      await sleep(PAUSE_MS);

      await sendTimed(
        connection,
        sender,
        instructions.closeHold({ caller: sender.publicKey, hold, programId }),
      );
      await sleep(PAUSE_MS);
    }
  } finally {
    // Whatever happened above, the throwaway key gives back what it still has.
    returned = await returnLeftover(connection, sender, funder.publicKey).catch(() => 0);
  }

  return {
    available: true,
    cluster_rpc_host: new URL(rpcUrl).hostname,
    program_id: programId.toBase58(),
    commitment: 'confirmed',
    iterations: createMs.length,
    create_hold: summarise(createMs),
    reclaim: summarise(reclaimMs),
    funded_lamports: FUNDING_LAMPORTS,
    returned_lamports: returned,
    signatures,
    note: 'milliseconds from sendRawTransaction to confirmed commitment; SOL holds, one at a time, with an untimed pause between transactions; any rate-limit retry of the RPC endpoint inside a transaction is included',
  };
}
