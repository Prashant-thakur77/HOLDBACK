import type { TransactionInstruction } from '@solana/web3.js';

/** Account roles as `@solana/kit` numbers them. */
const ROLE = { READONLY: 0, WRITABLE: 1, READONLY_SIGNER: 2, WRITABLE_SIGNER: 3 } as const;

export interface KitInstruction {
  programAddress: string;
  accounts: { address: string; role: number }[];
  data: Uint8Array;
}

/**
 * Converts an instruction built by this SDK into the plain shape
 * `@solana/kit` expects, without importing it. The result is structurally an
 * `Instruction`; cast the address strings with kit's `address()` if your
 * types require the branded form.
 */
export function toKitInstruction(instruction: TransactionInstruction): KitInstruction {
  return {
    programAddress: instruction.programId.toBase58(),
    accounts: instruction.keys.map((key) => ({
      address: key.pubkey.toBase58(),
      role: key.isSigner
        ? key.isWritable
          ? ROLE.WRITABLE_SIGNER
          : ROLE.READONLY_SIGNER
        : key.isWritable
          ? ROLE.WRITABLE
          : ROLE.READONLY,
    })),
    data: Uint8Array.from(instruction.data),
  };
}
