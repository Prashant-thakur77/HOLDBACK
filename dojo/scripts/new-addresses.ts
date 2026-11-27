/**
 * Prints fresh recipient addresses for new scenarios.
 *
 *   npm run new-addresses --workspace dojo -- 5
 *
 * Each address is the public half of a new ed25519 key pair whose private
 * half is discarded at once, so it is a valid Solana address that nobody,
 * including us, can ever spend from or be mistaken for.
 */
import { generateKeyPairSync } from 'node:crypto';

import { encodeBase58 } from '../src/base58';

const RAW_KEY_BYTES = 32;

function newAddress(): string {
  const { publicKey } = generateKeyPairSync('ed25519');
  // The DER encoding ends with the 32 raw key bytes.
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return encodeBase58(new Uint8Array(der.subarray(der.length - RAW_KEY_BYTES)));
}

const count = Number(process.argv[2] ?? 1);
for (let i = 0; i < count; i++) console.log(newAddress());
