import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { parseEvents as sdkParseEvents } from '../../sdk/src/events';
import sdkIdl from '../../sdk/src/idl/holdback.json';
import { encodeBase58 } from '../functions/_shared/base58.ts';
import { PROGRAM_ID, decodeEvent, parseEvents } from '../functions/_shared/events.ts';
import sharedIdl from '../functions/_shared/holdback.idl.json';
import {
  CREATED_AT,
  SOL_MINT,
  TOKEN_PROGRAM,
  address,
  eventBytes,
  eventLog,
  evidenceHash,
  holdCreated,
  holdReclaimed,
  holdReleased,
  holdbackInstruction,
  instantTransfer,
  invocation,
  newHold,
  transactionLogs,
  windowExtended,
} from './helpers/fixtures.ts';

/** The SDK resolves its own copy of web3.js, so `instanceof PublicKey` cannot be used. */
function isAddress(value: unknown): value is { toBase58(): string } {
  return typeof (value as { toBase58?: unknown } | null)?.toBase58 === 'function';
}

describe('IDL copy', () => {
  it('is identical to the IDL the SDK ships', () => {
    expect(sharedIdl).toEqual(sdkIdl);
  });
});

describe('encodeBase58', () => {
  it('matches the reference encoding for addresses', () => {
    for (let i = 0; i < 20; i++) {
      const key = new PublicKey(address());
      expect(encodeBase58(key.toBytes())).toBe(key.toBase58());
    }
  });

  it('keeps leading zero bytes', () => {
    expect(encodeBase58(new Uint8Array(32))).toBe(SOL_MINT);
    expect(encodeBase58(new PublicKey(TOKEN_PROGRAM).toBytes())).toBe(TOKEN_PROGRAM);
    expect(encodeBase58(Uint8Array.of(0, 0, 1))).toBe('112');
  });
});

describe('decodeEvent', () => {
  const hold = newHold();

  it('decodes HoldCreated field for field', () => {
    const event = decodeEvent(
      eventBytes('HoldCreated', {
        ...hold,
        createdAt: CREATED_AT,
        releaseAt: CREATED_AT + 1_800n,
        origin: 1,
        evidenceHash,
        nonce: 18_446_744_073_709_551_615n,
      }),
    );
    expect(event).toEqual({
      name: 'HoldCreated',
      data: {
        ...hold,
        createdAt: CREATED_AT,
        releaseAt: CREATED_AT + 1_800n,
        origin: 1,
        evidenceHash,
        nonce: 18_446_744_073_709_551_615n,
      },
    });
  });

  it('decodes negative i64 values', () => {
    const bytes = eventBytes('TrustSet', {
      sender: hold.sender,
      recipient: hold.recipient,
      timestamp: -5n,
    });
    expect(decodeEvent(bytes)?.data).toMatchObject({ timestamp: -5n });
  });

  it('decodes every event the IDL declares', () => {
    const samples: Record<string, Record<string, unknown>> = {
      HoldCreated: { ...hold, createdAt: 1n, releaseAt: 2n, origin: 0, evidenceHash, nonce: 3n },
      WindowExtended: {
        ...hold,
        oldReleaseAt: 1n,
        newReleaseAt: 2n,
        timestamp: 1n,
        evidenceHash,
      },
      HoldReclaimed: { ...hold, timestamp: 1n, by: hold.sender },
      HoldReleased: { ...hold, timestamp: 1n, early: true },
      InstantTransfer: { ...hold, timestamp: 1n },
      TrustSet: { sender: hold.sender, recipient: hold.recipient, timestamp: 1n },
      TrustRemoved: { sender: hold.sender, recipient: hold.recipient, timestamp: 1n },
      SubjectFlagged: {
        reporter: hold.sender,
        subject: hold.recipient,
        reason: 2,
        evidenceHash,
        totalFlags: 7,
        timestamp: 1n,
      },
      DepositBoxOpened: {
        depositBox: hold.hold,
        owner: hold.sender,
        mint: hold.mint,
        timestamp: 1n,
      },
      DepositWithdrawn: {
        depositBox: hold.hold,
        owner: hold.sender,
        mint: hold.mint,
        amount: 9n,
        timestamp: 1n,
        by: hold.sender,
      },
    };
    expect(Object.keys(samples).sort()).toEqual(sdkIdl.events.map((event) => event.name).sort());
    for (const [name, fields] of Object.entries(samples)) {
      expect(decodeEvent(eventBytes(name, fields))?.name).toBe(name);
    }
  });

  it('rejects unknown discriminators, short payloads and trailing bytes', () => {
    const bytes = eventBytes('HoldReleased', { ...hold, timestamp: 1n, early: false });
    expect(decodeEvent(bytes)).not.toBeNull();
    expect(decodeEvent(bytes.subarray(0, bytes.length - 1))).toBeNull();
    expect(decodeEvent(Uint8Array.of(...bytes, 0))).toBeNull();
    expect(decodeEvent(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, ...bytes.subarray(8)))).toBeNull();
    expect(decodeEvent(new Uint8Array(4))).toBeNull();
  });
});

describe('parseEvents', () => {
  const hold = newHold();
  const attacker = address();

  it('reads events from a realistic transaction log, in order', () => {
    const logs = transactionLogs(
      holdbackInstruction('CreateHold', [holdCreated(hold)]),
      holdbackInstruction('ReleaseEarly', [holdReleased(hold, { early: true })]),
    );
    const events = parseEvents(logs);
    expect(events.map((event) => event.name)).toEqual(['HoldCreated', 'HoldReleased']);
    expect(events[0]?.data).toMatchObject({ hold: hold.hold, amount: 25_000_000n });
  });

  it('agrees with the SDK parser on the same logs', () => {
    const logs = transactionLogs(
      holdbackInstruction('CreateHold', [holdCreated(hold)]),
      holdbackInstruction('ExtendWindow', [windowExtended(hold)]),
      holdbackInstruction('Reclaim', [holdReclaimed(hold)]),
      holdbackInstruction('InstantTransfer', [instantTransfer()]),
    );
    const ours = parseEvents(logs);
    const theirs = sdkParseEvents(logs);
    expect(ours.map((event) => event.name)).toEqual(theirs.map((event) => event.name));
    theirs.forEach((event, i) => {
      const data = event.data as unknown as Record<string, unknown>;
      for (const [field, value] of Object.entries(data)) {
        const expected = isAddress(value) ? value.toBase58() : value;
        expect((ours[i]!.data as Record<string, unknown>)[field]).toEqual(expected);
      }
    });
  });

  it('accepts an event emitted when another program calls HOLDBACK', () => {
    const logs = invocation(attacker, [
      ...invocation(PROGRAM_ID, ['Program log: Instruction: Release', holdReleased(hold)], 2),
    ]);
    expect(parseEvents(logs).map((event) => event.name)).toEqual(['HoldReleased']);
  });

  it('ignores the same bytes logged by another program', () => {
    const forged = holdCreated(hold);
    const cases: string[][] = [
      // A program that never touches HOLDBACK.
      invocation(attacker, [forged]),
      // A program HOLDBACK calls, logging while it is the one executing.
      invocation(PROGRAM_ID, [...invocation(attacker, [forged], 2)]),
      // A program that calls HOLDBACK and logs after the call returned.
      invocation(attacker, [...invocation(PROGRAM_ID, [], 2), forged]),
      // After HOLDBACK finished, in a later instruction.
      [...invocation(PROGRAM_ID, []), ...invocation(attacker, [forged])],
      // Outside any invocation at all.
      [forged],
    ];
    for (const logs of cases) expect(parseEvents(logs)).toEqual([]);
  });

  it('cannot be fooled by a program that logs runtime-looking text', () => {
    // Program output is always prefixed, so this is all an attacker can print.
    const logs = invocation(attacker, [
      `Program log: Program ${PROGRAM_ID} invoke [1]`,
      holdCreated(hold),
    ]);
    expect(parseEvents(logs)).toEqual([]);
  });

  it('pops the frame of a program that failed', () => {
    const logs = [
      `Program ${attacker} invoke [1]`,
      `Program ${PROGRAM_ID} invoke [2]`,
      `Program ${PROGRAM_ID} failed: custom program error: 0x1770`,
      holdCreated(hold),
      `Program ${attacker} success`,
    ];
    expect(parseEvents(logs)).toEqual([]);
  });

  it('re-anchors on the invoke depth when a closing line is missing', () => {
    const logs = [
      `Program ${PROGRAM_ID} invoke [1]`,
      // No success line for HOLDBACK: the next top-level invoke replaces it.
      `Program ${attacker} invoke [1]`,
      holdCreated(hold),
      `Program ${attacker} success`,
    ];
    expect(parseEvents(logs)).toEqual([]);
  });

  it('skips payloads that are not events', () => {
    const logs = invocation(PROGRAM_ID, [
      'Program data: not base64 !!',
      'Program data: AAECAwQFBgcICQ==',
      eventLog('TrustSet', { sender: hold.sender, recipient: hold.recipient, timestamp: 1n }),
    ]);
    expect(parseEvents(logs).map((event) => event.name)).toEqual(['TrustSet']);
  });

  it('honours a program id override', () => {
    const other = address();
    const logs = invocation(other, [holdCreated(hold)]);
    expect(parseEvents(logs, other)).toHaveLength(1);
    expect(parseEvents(logs)).toHaveLength(0);
  });
});
