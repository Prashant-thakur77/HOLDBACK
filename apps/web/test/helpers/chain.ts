/**
 * A fake Solana RPC for tests: a map of accounts and canned answers for the
 * few methods the SDK calls while building a transaction.
 */
import {
  IDL,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  accountDiscriminator,
  configPda,
  trustPda,
} from '@holdback/sdk';
import {
  Keypair,
  PublicKey,
  VersionedTransaction,
  type AccountInfo,
  type Connection,
} from '@solana/web3.js';

export const BLOCKHASH = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi';

function account(owner: PublicKey, data: Uint8Array): AccountInfo<Buffer> {
  return { owner, data: Buffer.from(data), lamports: 1_000_000, executable: false };
}

/** An SPL mint account: 82 bytes with the decimals at offset 44. */
export function mintAccount(decimals: number): AccountInfo<Buffer> {
  const data = new Uint8Array(82);
  data[44] = decimals;
  return account(TOKEN_PROGRAM_ID, data);
}

/** `isTrusted` only checks that the PDA exists and belongs to the program. */
export function trustAccount(): AccountInfo<Buffer> {
  return account(PROGRAM_ID, new Uint8Array(81));
}

function u32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

/** A `Config` account in the program's layout. */
export function configAccount(minWindowSecs: number): AccountInfo<Buffer> {
  const key = () => Array.from(Keypair.generate().publicKey.toBytes());
  return account(
    PROGRAM_ID,
    Uint8Array.from([
      ...accountDiscriminator('Config'),
      ...key(),
      ...key(),
      ...key(),
      ...u32(minWindowSecs),
      ...u32(1_800),
      ...u32(2_592_000),
      0,
      255,
    ]),
  );
}

export interface FakeChain {
  connection: Connection;
  accounts: Map<string, AccountInfo<Buffer>>;
  setTrust(sender: PublicKey, recipient: PublicKey): void;
  setConfig(minWindowSecs: number): void;
}

export function fakeChain(options: { failing?: boolean } = {}): FakeChain {
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const guard = <T>(value: T): Promise<T> =>
    options.failing ? Promise.reject(new Error('RPC unreachable')) : Promise.resolve(value);
  const rpc = {
    getAccountInfo: (address: PublicKey) => guard(accounts.get(address.toBase58()) ?? null),
    getLatestBlockhash: () => guard({ blockhash: BLOCKHASH, lastValidBlockHeight: 1_000 }),
    getRecentPrioritizationFees: () => guard([{ slot: 1, prioritizationFee: 5_000 }]),
  };
  return {
    connection: rpc as unknown as Connection,
    accounts,
    setTrust: (sender, recipient) =>
      void accounts.set(trustPda(sender, recipient).toBase58(), trustAccount()),
    setConfig: (minWindowSecs) =>
      void accounts.set(configPda().toBase58(), configAccount(minWindowSecs)),
  };
}

export interface DecodedPayment {
  /** IDL name of the HOLDBACK instruction in the transaction. */
  name: string;
  accounts: string[];
  feePayer: string;
  amount: bigint;
  /** Present for `create_hold` and `create_hold_sol` only. */
  windowSecs?: number;
  tier?: number;
  evidenceHash?: string;
}

const u64At = (data: Uint8Array, offset: number) =>
  new DataView(data.buffer, data.byteOffset).getBigUint64(offset, true);

/** Finds and decodes the HOLDBACK instruction in a base64 transaction. */
export function decodePayment(base64: string): DecodedPayment {
  const transaction = VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
  const { staticAccountKeys, compiledInstructions } = transaction.message;
  const instruction = compiledInstructions.find((ix) =>
    staticAccountKeys[ix.programIdIndex]?.equals(PROGRAM_ID),
  );
  if (!instruction) throw new Error('No HOLDBACK instruction in the transaction');

  const data = instruction.data;
  const spec = IDL.instructions.find((candidate) =>
    candidate.discriminator.every((byte, index) => data[index] === byte),
  );
  if (!spec) throw new Error('Unknown HOLDBACK instruction');

  const base = {
    name: spec.name,
    accounts: instruction.accountKeyIndexes.map((index) => staticAccountKeys[index]!.toBase58()),
    feePayer: staticAccountKeys[0]!.toBase58(),
  };
  if (spec.name.startsWith('instant_transfer')) return { ...base, amount: u64At(data, 8) };
  // create_hold args: nonce u64, amount u64, window_secs u32, tier u8, evidence_hash [u8; 32]
  return {
    ...base,
    amount: u64At(data, 16),
    windowSecs: new DataView(data.buffer, data.byteOffset).getUint32(24, true),
    tier: data[28],
    evidenceHash: Buffer.from(data.subarray(29, 61)).toString('hex'),
  };
}
