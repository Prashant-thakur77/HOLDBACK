/**
 * Re-checks every devnet proof from public data, with no keys.
 *
 *   npx tsx scripts/verify-proofs.ts            # uses https://api.devnet.solana.com
 *   RPC_URL=<any devnet RPC> npx tsx scripts/verify-proofs.ts
 *
 * For each entry in proofs/devnet.json it fetches the transaction and checks:
 *   - the HOLDBACK program was invoked by it;
 *   - a "happy path" entry succeeded;
 *   - an "attack" entry failed, with the error recorded for it (the Anchor
 *     error name from the logs, or the raw instruction error).
 * Before that it checks the program itself: that the bytes deployed on devnet
 * hash to the value the reproducible build produces (proofs/build.json; the
 * same sha256 `solana-verify get-program-hash` prints), and it prints which
 * keys the on-chain config trusts and who holds the upgrade authority.
 * Exits 1 if anything does not match.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { Connection, PublicKey } from '@solana/web3.js';

import { configPda, decodeConfig } from '../sdk/src';

interface Proof {
  id: string;
  kind: 'happy path' | 'attack';
  description: string;
  error: string | null;
  signature: string;
}

interface Report {
  program: string;
  proofs: Proof[];
}

const RPC = process.env.RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(RPC, 'confirmed');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchTx(signature: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const tx = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (tx) return tx;
    } catch {
      // Public RPC rate limits: back off and retry.
    }
    await sleep(1_000 * (attempt + 1));
  }
  return null;
}

/** The error a failed transaction shows: the Anchor name, or the raw error. */
function observedError(logs: string[], err: unknown): string {
  const anchor = logs.join('\n').match(/Error Code: (\w+)/)?.[1];
  if (anchor) return anchor;
  if (logs.some((line) => /already in use/.test(line)))
    return 'AccountAlreadyInUse (system program)';
  return JSON.stringify(err);
}

interface Build {
  program_hash: string;
  base_image: string;
  commit: string;
}

const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

/** Program checks; returns the number of failures. */
async function checkProgram(programId: PublicKey): Promise<number> {
  let failures = 0;
  const [programData] = PublicKey.findProgramAddressSync([programId.toBytes()], LOADER);
  const account = await connection.getAccountInfo(programData);
  if (!account) {
    console.log('FAIL  program data account not found');
    return 1;
  }
  // ProgramData: 4-byte tag, 8-byte slot, Option<Pubkey> authority, then the ELF.
  const data = account.data;
  const authority = data[12] === 1 ? new PublicKey(data.subarray(13, 45)).toBase58() : 'none';
  let end = data.length;
  while (end > 45 && data[end - 1] === 0) end--;
  const hash = createHash('sha256').update(data.subarray(45, end)).digest('hex');
  if (existsSync('proofs/build.json')) {
    const build = JSON.parse(readFileSync('proofs/build.json', 'utf8')) as Build;
    const ok = hash === build.program_hash;
    if (!ok) failures++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  deployed program hash ${hash.slice(0, 16)}… ${ok ? 'equals' : 'differs from'} the reproducible build (${build.base_image}, commit ${build.commit})`,
    );
  } else {
    console.log(`INFO  deployed program hash ${hash} (no proofs/build.json to compare)`);
  }
  console.log(`INFO  upgrade authority: ${authority}`);

  const config = await connection.getAccountInfo(configPda(programId));
  if (!config) {
    console.log('FAIL  config account not found');
    return failures + 1;
  }
  const decoded = decodeConfig(config.data);
  console.log(`INFO  risk oracle (can only lengthen windows): ${decoded.riskOracle.toBase58()}`);
  console.log(`INFO  relayer (deposit boxes only): ${decoded.relayer.toBase58()}`);
  console.log(
    `INFO  windows: min ${decoded.minWindowSecs}s, default ${decoded.defaultWindowSecs}s, max ${decoded.maxWindowSecs}s; paused ${decoded.paused}`,
  );
  return failures;
}

async function main() {
  const report = JSON.parse(readFileSync('proofs/devnet.json', 'utf8')) as Report;
  let failures = await checkProgram(new PublicKey(report.program));
  console.log('');
  console.log(`Checking ${report.proofs.length} transactions on ${new URL(RPC).host}\n`);

  for (const proof of report.proofs) {
    const tx = await fetchTx(proof.signature);
    let verdict: string;
    if (!tx) {
      verdict = 'FAIL  transaction not found';
    } else {
      const logs = tx.meta?.logMessages ?? [];
      const err = tx.meta?.err ?? null;
      const invoked =
        logs.some((line) => line.startsWith(`Program ${report.program} invoke`)) ||
        proof.id === 'H18'; // a plain token transfer into the deposit box, by design
      if (!invoked) verdict = 'FAIL  program not invoked';
      else if (proof.kind === 'happy path')
        verdict =
          err === null ? 'PASS  executed' : `FAIL  expected success, got ${JSON.stringify(err)}`;
      else if (err === null) verdict = 'FAIL  attack executed';
      else {
        const seen = observedError(logs, err);
        verdict =
          seen === proof.error
            ? `PASS  refused: ${seen}`
            : `FAIL  refused with ${seen}, recorded ${proof.error}`;
      }
    }
    if (verdict.startsWith('FAIL')) failures++;
    console.log(`${proof.id.padEnd(4)} ${verdict.padEnd(46)} ${proof.description}`);
    await sleep(250);
  }

  console.log(
    `\n${report.proofs.length - failures} of ${report.proofs.length} match the record${failures ? `; ${failures} do not` : ''}.`,
  );
  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
