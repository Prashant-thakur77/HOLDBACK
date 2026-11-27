/**
 * Anchor events of the HOLDBACK program, read from transaction logs.
 *
 * Anchor's `emit!` writes each event as a `Program data: <base64>` log line:
 * an 8-byte discriminator followed by the Borsh-encoded struct. The webhook
 * rebuilds every hold from these lines alone.
 */
import idl from './holdback.idl.json' with { type: 'json' };
import { Reader, decodeStruct } from './borsh.ts';

/** The deployed program's address, as recorded in the IDL. */
export const PROGRAM_ID: string = idl.address;

/** Fields every hold event carries. Addresses are base58 strings. */
interface HoldEventBase {
  hold: string;
  sender: string;
  recipient: string;
  /** The all-zero address (`1111…`) marks a native SOL hold. */
  mint: string;
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
  | { name: 'HoldReclaimed'; data: HoldEventBase & { timestamp: bigint; by: string } }
  | { name: 'HoldReleased'; data: HoldEventBase & { timestamp: bigint; early: boolean } }
  | { name: 'InstantTransfer'; data: Omit<HoldEventBase, 'hold'> & { timestamp: bigint } }
  | {
      /** Events the mirror does not store: trust, flags and deposit-box activity. */
      name:
        'TrustSet' | 'TrustRemoved' | 'SubjectFlagged' | 'DepositBoxOpened' | 'DepositWithdrawn';
      data: Record<string, unknown>;
    };

const PROGRAM_DATA = 'Program data: ';
const DISCRIMINATOR_LENGTH = 8;

function base64ToBytes(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function startsWith(data: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, i) => data[i] === byte);
}

/**
 * Decodes one `Program data:` payload. Returns null when the discriminator is
 * not one of ours or the body does not match the struct exactly: a payload
 * that is too short or has bytes left over was not written by this program.
 */
export function decodeEvent(data: Uint8Array): HoldbackEvent | null {
  if (data.length < DISCRIMINATOR_LENGTH) return null;
  const spec = idl.events.find((event) => startsWith(data, event.discriminator));
  if (!spec) return null;
  try {
    const reader = new Reader(data.subarray(DISCRIMINATOR_LENGTH));
    const decoded = decodeStruct(spec.name, reader);
    if (!reader.done) return null;
    return { name: spec.name, data: decoded } as HoldbackEvent;
  } catch {
    return null;
  }
}

/**
 * Extracts HOLDBACK events from a transaction's log messages, in log order.
 *
 * Any program can log arbitrary bytes, so a line only counts when HOLDBACK is
 * the program executing at that moment. The runtime itself writes the
 * `invoke [depth]` / `success` / `failed` lines (program output is always
 * prefixed `Program log:` or `Program data:`), which makes them a trustworthy
 * call stack. The depth in each `invoke` line re-anchors the stack, so a
 * missing line cannot leave a stale frame on top.
 */
export function parseEvents(
  logs: readonly string[],
  programId: string = PROGRAM_ID,
): HoldbackEvent[] {
  const stack: string[] = [];
  const events: HoldbackEvent[] = [];

  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      stack.length = Math.min(stack.length, Number(invoke[2]) - 1);
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith(PROGRAM_DATA) && stack[stack.length - 1] === programId) {
      const bytes = base64ToBytes(line.slice(PROGRAM_DATA.length));
      const event = bytes && decodeEvent(bytes);
      if (event) events.push(event);
    }
  }
  return events;
}
