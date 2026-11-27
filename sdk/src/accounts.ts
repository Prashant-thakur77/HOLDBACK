import { Connection, PublicKey, type Commitment } from '@solana/web3.js';

import { Reader, decodeStruct, sameBytes } from './codec';
import { HoldStatus, NATIVE_SOL_MINT, PROGRAM_ID, type HoldOrigin, type Tier } from './constants';
import idl from './idl/holdback.json';
import { configPda, depositBoxPda, statsPda, trustPda } from './pdas';

export interface Config {
  admin: PublicKey;
  relayer: PublicKey;
  riskOracle: PublicKey;
  minWindowSecs: number;
  defaultWindowSecs: number;
  maxWindowSecs: number;
  paused: boolean;
  bump: number;
}

export interface Hold {
  address: PublicKey;
  sender: PublicKey;
  recipient: PublicKey;
  /** `PublicKey.default` for a native SOL hold. */
  mint: PublicKey;
  /** Base units of the mint (lamports for SOL). */
  amount: bigint;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds from which anyone may release to the recipient. */
  releaseAt: number;
  tier: Tier;
  evidenceHash: Uint8Array;
  origin: HoldOrigin;
  status: HoldStatus;
  rentPayer: PublicKey;
  nonce: bigint;
  bump: number;
  isSol: boolean;
}

export interface Trust {
  sender: PublicKey;
  recipient: PublicKey;
  createdAt: number;
  bump: number;
}

export interface DepositBox {
  address: PublicKey;
  owner: PublicKey;
  bump: number;
}

export interface Flag {
  reporter: PublicKey;
  subject: PublicKey;
  reason: number;
  evidenceHash: Uint8Array;
  createdAt: number;
  bump: number;
}

export interface SubjectStats {
  subject: PublicKey;
  flags: number;
  holdsReceived: number;
  holdsReclaimedAgainst: number;
  holdsReleasedTo: number;
  bump: number;
}

type AccountName = 'Config' | 'Hold' | 'Trust' | 'DepositBox' | 'Flag' | 'SubjectStats';

const discriminators = new Map<string, number[]>(
  idl.accounts.map((account) => [account.name, account.discriminator]),
);

export function accountDiscriminator(name: AccountName): Uint8Array {
  const bytes = discriminators.get(name);
  if (!bytes) throw new Error(`Unknown account: ${name}`);
  return Uint8Array.from(bytes);
}

function decode(name: AccountName, data: Uint8Array): Record<string, unknown> {
  if (data.length < 8 || !sameBytes(data.subarray(0, 8), accountDiscriminator(name))) {
    throw new Error(`Account data is not a ${name}`);
  }
  return decodeStruct(name, new Reader(data.subarray(8)));
}

const seconds = (value: unknown) => Number(value as bigint);

export function decodeConfig(data: Uint8Array): Config {
  return decode('Config', data) as unknown as Config;
}

export function decodeHold(address: PublicKey, data: Uint8Array): Hold {
  const raw = decode('Hold', data);
  const mint = raw.mint as PublicKey;
  return {
    ...(raw as unknown as Hold),
    address,
    createdAt: seconds(raw.createdAt),
    releaseAt: seconds(raw.releaseAt),
    isSol: mint.equals(NATIVE_SOL_MINT),
  };
}

export function decodeTrust(data: Uint8Array): Trust {
  const raw = decode('Trust', data);
  return { ...(raw as unknown as Trust), createdAt: seconds(raw.createdAt) };
}

export function decodeDepositBox(address: PublicKey, data: Uint8Array): DepositBox {
  return { ...(decode('DepositBox', data) as unknown as DepositBox), address };
}

export function decodeFlag(data: Uint8Array): Flag {
  const raw = decode('Flag', data);
  return { ...(raw as unknown as Flag), createdAt: seconds(raw.createdAt) };
}

export function decodeSubjectStats(data: Uint8Array): SubjectStats {
  return decode('SubjectStats', data) as unknown as SubjectStats;
}

export interface FetchOptions {
  programId?: PublicKey;
  commitment?: Commitment;
}

async function load(
  connection: Connection,
  address: PublicKey,
  options: FetchOptions,
): Promise<Uint8Array | null> {
  const info = await connection.getAccountInfo(address, options.commitment);
  const programId = options.programId ?? PROGRAM_ID;
  if (!info || !info.owner.equals(programId)) return null;
  return info.data;
}

export async function fetchConfig(
  connection: Connection,
  options: FetchOptions = {},
): Promise<Config | null> {
  const data = await load(connection, configPda(options.programId), options);
  return data ? decodeConfig(data) : null;
}

export async function fetchHold(
  connection: Connection,
  address: PublicKey,
  options: FetchOptions = {},
): Promise<Hold | null> {
  const data = await load(connection, address, options);
  return data ? decodeHold(address, data) : null;
}

/** True when `sender` has marked `recipient` as trusted. */
export async function isTrusted(
  connection: Connection,
  sender: PublicKey,
  recipient: PublicKey,
  options: FetchOptions = {},
): Promise<boolean> {
  const data = await load(connection, trustPda(sender, recipient, options.programId), options);
  return data !== null;
}

export async function fetchSubjectStats(
  connection: Connection,
  subject: PublicKey,
  options: FetchOptions = {},
): Promise<SubjectStats | null> {
  const data = await load(connection, statsPda(subject, options.programId), options);
  return data ? decodeSubjectStats(data) : null;
}

export async function fetchDepositBox(
  connection: Connection,
  owner: PublicKey,
  options: FetchOptions = {},
): Promise<DepositBox | null> {
  const address = depositBoxPda(owner, options.programId);
  const data = await load(connection, address, options);
  return data ? decodeDepositBox(address, data) : null;
}

const HOLD_SENDER_OFFSET = 8;
const HOLD_RECIPIENT_OFFSET = 8 + 32;
const HOLD_STATUS_OFFSET = 8 + 32 * 3 + 8 * 3 + 1 + 32 + 1;
const TRUST_SENDER_OFFSET = 8;

async function holdsWhere(
  connection: Connection,
  offset: number,
  party: PublicKey,
  options: FetchOptions & { pendingOnly?: boolean },
): Promise<Hold[]> {
  const programId = options.programId ?? PROGRAM_ID;
  const filters = [
    { memcmp: { offset: 0, bytes: encodeBase58(accountDiscriminator('Hold')) } },
    { memcmp: { offset, bytes: party.toBase58() } },
  ];
  if (options.pendingOnly) {
    filters.push({
      memcmp: {
        offset: HOLD_STATUS_OFFSET,
        bytes: encodeBase58(Uint8Array.of(HoldStatus.PENDING)),
      },
    });
  }
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: options.commitment,
    filters,
  });
  return accounts
    .map(({ pubkey, account }) => decodeHold(pubkey, account.data))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Open (not yet closed) holds sent by `sender`, newest first. */
export function fetchHoldsBySender(
  connection: Connection,
  sender: PublicKey,
  options: FetchOptions & { pendingOnly?: boolean } = {},
): Promise<Hold[]> {
  return holdsWhere(connection, HOLD_SENDER_OFFSET, sender, options);
}

/** Open (not yet closed) holds addressed to `recipient`, newest first. */
export function fetchHoldsByRecipient(
  connection: Connection,
  recipient: PublicKey,
  options: FetchOptions & { pendingOnly?: boolean } = {},
): Promise<Hold[]> {
  return holdsWhere(connection, HOLD_RECIPIENT_OFFSET, recipient, options);
}

/** Everyone `sender` has marked as trusted. */
export async function fetchTrustedRecipients(
  connection: Connection,
  sender: PublicKey,
  options: FetchOptions = {},
): Promise<Trust[]> {
  const accounts = await connection.getProgramAccounts(options.programId ?? PROGRAM_ID, {
    commitment: options.commitment,
    filters: [
      { memcmp: { offset: 0, bytes: encodeBase58(accountDiscriminator('Trust')) } },
      { memcmp: { offset: TRUST_SENDER_OFFSET, bytes: sender.toBase58() } },
    ],
  });
  return accounts.map(({ account }) => decodeTrust(account.data));
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 of arbitrary bytes, for `memcmp` filters. */
export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}
