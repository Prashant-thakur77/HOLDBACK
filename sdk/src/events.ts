import type { PublicKey } from '@solana/web3.js';

import { Reader, decodeStruct, sameBytes } from './codec';
import { PROGRAM_ID } from './constants';
import idl from './idl/holdback.json';

interface HoldEventBase {
  hold: PublicKey;
  sender: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  amount: bigint;
  tier: number;
}

export type HoldbackEvent =
  | {
      name: 'HoldCreated';
      data: HoldEventBase & {
        createdAt: bigint;
        releaseAt: bigint;
        origin: number;
        evidenceHash: Uint8Array;
        nonce: bigint;
      };
    }
  | {
      name: 'WindowExtended';
      data: HoldEventBase & {
        oldReleaseAt: bigint;
        newReleaseAt: bigint;
        timestamp: bigint;
        evidenceHash: Uint8Array;
      };
    }
  | { name: 'HoldReclaimed'; data: HoldEventBase & { timestamp: bigint; by: PublicKey } }
  | { name: 'HoldReleased'; data: HoldEventBase & { timestamp: bigint; early: boolean } }
  | {
      name: 'InstantTransfer';
      data: Omit<HoldEventBase, 'hold'> & { timestamp: bigint };
    }
  | {
      name: 'TrustSet' | 'TrustRemoved';
      data: { sender: PublicKey; recipient: PublicKey; timestamp: bigint };
    }
  | {
      name: 'SubjectFlagged';
      data: {
        reporter: PublicKey;
        subject: PublicKey;
        reason: number;
        evidenceHash: Uint8Array;
        totalFlags: number;
        timestamp: bigint;
      };
    }
  | {
      name: 'DepositBoxOpened';
      data: { depositBox: PublicKey; owner: PublicKey; mint: PublicKey; timestamp: bigint };
    }
  | {
      name: 'DepositWithdrawn';
      data: {
        depositBox: PublicKey;
        owner: PublicKey;
        mint: PublicKey;
        amount: bigint;
        timestamp: bigint;
        by: PublicKey;
      };
    };

const PROGRAM_DATA = 'Program data: ';

function base64ToBytes(text: string): Uint8Array | null {
  try {
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(text, 'base64'));
    const binary = atob(text);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Decodes one `Program data:` payload, or returns null if it is not ours. */
export function decodeEvent(data: Uint8Array): HoldbackEvent | null {
  if (data.length < 8) return null;
  const head = data.subarray(0, 8);
  const spec = idl.events.find((event) => sameBytes(event.discriminator, head));
  if (!spec) return null;
  try {
    const decoded = decodeStruct(spec.name, new Reader(data.subarray(8)));
    return { name: spec.name, data: decoded } as HoldbackEvent;
  } catch {
    return null;
  }
}

/**
 * Extracts HOLDBACK events from a transaction's log messages. Only data
 * logged while the HOLDBACK program is the executing program is considered,
 * so another program cannot forge an event by logging the same bytes.
 */
export function parseEvents(
  logs: readonly string[],
  programId: PublicKey = PROGRAM_ID,
): HoldbackEvent[] {
  const id = programId.toBase58();
  const stack: string[] = [];
  const events: HoldbackEvent[] = [];

  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith(PROGRAM_DATA) && stack[stack.length - 1] === id) {
      const bytes = base64ToBytes(line.slice(PROGRAM_DATA.length));
      const event = bytes && decodeEvent(bytes);
      if (event) events.push(event);
    }
  }
  return events;
}
