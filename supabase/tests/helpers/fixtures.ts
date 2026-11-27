/**
 * Test fixtures: real event bytes and realistic Helius deliveries.
 *
 * Events are encoded with the SDK's own codec and IDL, so the webhook's
 * independent decoder is checked against the encoder the rest of the project
 * uses rather than against bytes written by hand.
 */
import { Keypair, PublicKey } from '@solana/web3.js';

import { encodeType } from '../../../sdk/src/codec';
import sdkIdl from '../../../sdk/src/idl/holdback.json';

export const PROGRAM_ID: string = sdkIdl.address;
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
export const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const SOL_MINT = PublicKey.default.toBase58();
export const SECRET = 'test-webhook-secret';

export const address = (): string => Keypair.generate().publicKey.toBase58();

/** A syntactically valid signature (base58 of 64 bytes); nothing verifies it. */
export const signature = (): string =>
  Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58();

export const evidenceHash = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
export const evidenceHashHex = Buffer.from(evidenceHash).toString('hex');

type Fields = Record<string, unknown>;

/** Addresses are passed around as base58 text; the SDK codec wants `PublicKey`s. */
function withPublicKeys(fields: Fields): Fields {
  const keys = [
    'hold',
    'sender',
    'recipient',
    'mint',
    'by',
    'reporter',
    'subject',
    'depositBox',
    'owner',
  ];
  return Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [
      name,
      keys.includes(name) && typeof value === 'string' ? new PublicKey(value) : value,
    ]),
  );
}

/** The bytes Anchor's `emit!` logs: discriminator followed by the Borsh struct. */
export function eventBytes(name: string, fields: Fields): Uint8Array {
  const spec = sdkIdl.events.find((event) => event.name === name);
  if (!spec) throw new Error(`No such event: ${name}`);
  const out: number[] = [...spec.discriminator];
  encodeType({ defined: { name } }, withPublicKeys(fields), out);
  return Uint8Array.from(out);
}

/** The `Program data:` log line for an event. */
export function eventLog(name: string, fields: Fields): string {
  return `Program data: ${Buffer.from(eventBytes(name, fields)).toString('base64')}`;
}

/** Log lines of one top-level instruction, as the runtime prints them. */
export function invocation(program: string, body: string[], depth = 1): string[] {
  return [
    `Program ${program} invoke [${depth}]`,
    ...body,
    `Program ${program} consumed 21842 of 200000 compute units`,
    `Program ${program} success`,
  ];
}

/** A HOLDBACK instruction that makes a token CPI and then emits `events`. */
export function holdbackInstruction(instruction: string, events: string[]): string[] {
  return invocation(PROGRAM_ID, [
    `Program log: Instruction: ${instruction}`,
    ...invocation(TOKEN_PROGRAM, ['Program log: Instruction: TransferChecked'], 2),
    ...events,
  ]);
}

/** Full logs of a transaction: compute budget first, then the given instructions. */
export function transactionLogs(...instructions: string[][]): string[] {
  return [...invocation(COMPUTE_BUDGET, []), ...instructions.flat()];
}

export interface HoldFields {
  hold: string;
  sender: string;
  recipient: string;
  mint: string;
  amount: bigint;
  tier: number;
}

export function newHold(overrides: Partial<HoldFields> = {}): HoldFields {
  return {
    hold: address(),
    sender: address(),
    recipient: address(),
    mint: DEVNET_USDC,
    amount: 25_000_000n,
    tier: 2,
    ...overrides,
  };
}

export const CREATED_AT = 1_795_000_000n;

export function holdCreated(hold: HoldFields, overrides: Fields = {}): string {
  return eventLog('HoldCreated', {
    ...hold,
    createdAt: CREATED_AT,
    releaseAt: CREATED_AT + 21_600n,
    origin: 0,
    evidenceHash,
    nonce: 1_882_193_920_000_123n,
    ...overrides,
  });
}

export function windowExtended(hold: HoldFields, overrides: Fields = {}): string {
  return eventLog('WindowExtended', {
    ...hold,
    oldReleaseAt: CREATED_AT + 21_600n,
    newReleaseAt: CREATED_AT + 86_400n,
    timestamp: CREATED_AT + 60n,
    tier: 3,
    evidenceHash: Uint8Array.from({ length: 32 }, () => 0xab),
    ...overrides,
  });
}

export function holdReclaimed(hold: HoldFields, overrides: Fields = {}): string {
  return eventLog('HoldReclaimed', {
    ...hold,
    timestamp: CREATED_AT + 120n,
    by: hold.sender,
    ...overrides,
  });
}

export function holdReleased(hold: HoldFields, overrides: Fields = {}): string {
  return eventLog('HoldReleased', {
    ...hold,
    timestamp: CREATED_AT + 21_600n,
    early: false,
    ...overrides,
  });
}

export function instantTransfer(overrides: Fields = {}): string {
  return eventLog('InstantTransfer', {
    sender: address(),
    recipient: address(),
    mint: DEVNET_USDC,
    amount: 5_000_000n,
    timestamp: CREATED_AT,
    tier: 0,
    ...overrides,
  });
}

interface DeliveryOptions {
  signature?: string;
  slot?: number;
  /** A non-null value marks the transaction as failed. */
  err?: unknown;
}

/** One entry of a raw webhook delivery: the `getTransaction` shape. */
export function rawEntry(logs: string[], options: DeliveryOptions = {}) {
  const slot = options.slot ?? 412_345_678;
  return {
    blockTime: Number(CREATED_AT),
    indexWithinBlock: 17,
    meta: {
      err: options.err ?? null,
      fee: 5_000,
      innerInstructions: [],
      logMessages: logs,
      postBalances: [],
      preBalances: [],
      rewards: [],
    },
    slot,
    transaction: {
      message: { accountKeys: [], instructions: [], recentBlockhash: address() },
      signatures: [options.signature ?? signature()],
    },
    version: 0,
  };
}

/** One entry of an enhanced webhook delivery. It carries no log messages. */
export function enhancedEntry(options: DeliveryOptions = {}) {
  return {
    accountData: [],
    description: '',
    events: {},
    fee: 5_000,
    feePayer: address(),
    instructions: [],
    nativeTransfers: [],
    signature: options.signature ?? signature(),
    slot: options.slot ?? 412_345_678,
    source: 'UNKNOWN',
    timestamp: Number(CREATED_AT),
    tokenTransfers: [],
    transactionError: options.err ?? null,
    type: 'UNKNOWN',
  };
}

/** The POST Helius would make, with the shared secret unless told otherwise. */
export function delivery(body: unknown, authorization: string | null = SECRET): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (authorization !== null) headers.set('authorization', authorization);
  return new Request('https://project.supabase.co/functions/v1/helius-webhook', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
