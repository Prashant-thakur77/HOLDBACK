/**
 * Initializes (or prints) the program config on the cluster in
 * ANCHOR_PROVIDER_URL, signing with ANCHOR_WALLET (the upgrade authority).
 * The oracle and relayer public keys come from keys/oracle.json and
 * keys/relayer.json unless ORACLE_PUBKEY / RELAYER_PUBKEY are set.
 */
import { readFileSync } from 'node:fs';

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

import { configPda, fetchConfig, instructions, WINDOW_SECS_BY_TIER, Tier } from '../sdk/src';

function keypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

function pubkey(env: string, path: string): PublicKey {
  const value = process.env[env];
  return value ? new PublicKey(value) : keypair(path).publicKey;
}

async function main() {
  const url = process.env.ANCHOR_PROVIDER_URL ?? 'http://127.0.0.1:8899';
  const admin = keypair(process.env.ANCHOR_WALLET ?? 'keys/deployer.json');
  const connection = new Connection(url, 'confirmed');

  const existing = await fetchConfig(connection);
  if (existing) {
    console.log('Config already initialized:', configPda().toBase58());
  } else {
    const ix = instructions.initializeConfig({
      admin: admin.publicKey,
      relayer: pubkey('RELAYER_PUBKEY', 'keys/relayer.json'),
      riskOracle: pubkey('ORACLE_PUBKEY', 'keys/oracle.json'),
      minWindowSecs: 0,
      defaultWindowSecs: WINDOW_SECS_BY_TIER[Tier.UNKNOWN],
      maxWindowSecs: WINDOW_SECS_BY_TIER[Tier.SANCTIONED],
    });
    const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
      admin,
    ]);
    console.log('Config initialized:', configPda().toBase58(), 'tx', signature);
  }

  const config = await fetchConfig(connection);
  console.log({
    admin: config?.admin.toBase58(),
    relayer: config?.relayer.toBase58(),
    riskOracle: config?.riskOracle.toBase58(),
    minWindowSecs: config?.minWindowSecs,
    defaultWindowSecs: config?.defaultWindowSecs,
    maxWindowSecs: config?.maxWindowSecs,
    paused: config?.paused,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
