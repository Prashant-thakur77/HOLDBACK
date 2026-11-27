import { PublicKey } from '@solana/web3.js';

import { ASSOCIATED_TOKEN_PROGRAM_ID, PROGRAM_ID, SEEDS, TOKEN_PROGRAM_ID } from './constants';

const text = (value: string) => new TextEncoder().encode(value);

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let rest = BigInt.asUintN(64, value);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function find(seeds: Uint8Array[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export function configPda(programId: PublicKey = PROGRAM_ID): PublicKey {
  return find([text(SEEDS.config)], programId);
}

/** `["hold", sender, nonce_le_u64]` */
export function holdPda(
  sender: PublicKey,
  nonce: bigint,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return find([text(SEEDS.hold), sender.toBytes(), u64le(nonce)], programId);
}

/** `["trust", sender, recipient]` */
export function trustPda(
  sender: PublicKey,
  recipient: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return find([text(SEEDS.trust), sender.toBytes(), recipient.toBytes()], programId);
}

/** `["box", owner]` */
export function depositBoxPda(owner: PublicKey, programId: PublicKey = PROGRAM_ID): PublicKey {
  return find([text(SEEDS.box), owner.toBytes()], programId);
}

/** `["flag", reporter, subject]` */
export function flagPda(
  reporter: PublicKey,
  subject: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return find([text(SEEDS.flag), reporter.toBytes(), subject.toBytes()], programId);
}

/** `["stats", subject]` */
export function statsPda(subject: PublicKey, programId: PublicKey = PROGRAM_ID): PublicKey {
  return find([text(SEEDS.stats), subject.toBytes()], programId);
}

/** The associated token account of `owner` for `mint`. `owner` may be a PDA. */
export function associatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  return find(
    [owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/** A hold's vault: the associated token account owned by the hold PDA. */
export function vaultAddress(
  hold: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  return associatedTokenAddress(hold, mint, tokenProgram);
}
