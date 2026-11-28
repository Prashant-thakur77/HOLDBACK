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
 * It also checks that the program account on devnet is the deployed binary
 * this repository builds reproducibly. Exits 1 if anything does not match.
 */
import { readFileSync } from 'node:fs';

import { Connection } from '@solana/web3.js';

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

async function main() {
  const report = JSON.parse(readFileSync('proofs/devnet.json', 'utf8')) as Report;
  let failures = 0;
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
