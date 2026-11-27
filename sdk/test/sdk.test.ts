import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
  HoldOrigin,
  HoldStatus,
  IDL,
  PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  Tier,
  WINDOW_SECS_BY_TIER,
  accountDiscriminator,
  associatedTokenAddress,
  canonicalJson,
  configPda,
  decodeConfig,
  decodeEvent,
  decodeHold,
  decodeSubjectStats,
  depositBoxPda,
  encodeBase58,
  errorFromCode,
  explain,
  flagPda,
  formatAmount,
  formatDuration,
  fromHex,
  hashEvidence,
  holdPda,
  instructions,
  newNonce,
  parseAmount,
  parseEvents,
  parseProgramError,
  statsPda,
  tierName,
  toHex,
  toKitInstruction,
  trustPda,
  vaultAddress,
  verifyEvidence,
  type EvidenceDocument,
  type Hold,
} from '../src';
import { encodeType } from '../src/codec';

const sender = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const hash = Uint8Array.from({ length: 32 }, (_, i) => i);

function u64(value: bigint): number[] {
  const out: number[] = [];
  encodeType('u64', value, out);
  return out;
}

function holdBytes(fields: Partial<Record<string, unknown>> = {}): Uint8Array {
  const value = {
    sender,
    recipient,
    mint,
    amount: 25_000_000n,
    createdAt: 1_800_000_000n,
    releaseAt: 1_800_001_800n,
    tier: Tier.SUSPICIOUS,
    evidenceHash: hash,
    origin: HoldOrigin.WALLET,
    status: HoldStatus.PENDING,
    rentPayer: sender,
    nonce: 42n,
    bump: 254,
    ...fields,
  };
  const out: number[] = [...accountDiscriminator('Hold')];
  encodeType({ defined: { name: 'Hold' } }, value, out);
  return Uint8Array.from(out);
}

describe('PDAs', () => {
  it('derives every seed layout the program uses', () => {
    const text = (s: string) => Buffer.from(s);
    const nonce = Buffer.alloc(8);
    nonce.writeBigUInt64LE(42n);
    const find = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

    expect(configPda()).toEqual(find([text('config')]));
    expect(holdPda(sender, 42n)).toEqual(find([text('hold'), sender.toBuffer(), nonce]));
    expect(trustPda(sender, recipient)).toEqual(
      find([text('trust'), sender.toBuffer(), recipient.toBuffer()]),
    );
    expect(depositBoxPda(sender)).toEqual(find([text('box'), sender.toBuffer()]));
    expect(flagPda(sender, recipient)).toEqual(
      find([text('flag'), sender.toBuffer(), recipient.toBuffer()]),
    );
    expect(statsPda(recipient)).toEqual(find([text('stats'), recipient.toBuffer()]));
  });

  it('derives the canonical associated token address', () => {
    // Circle devnet USDC and a known wallet: checked against the token CLI.
    const owner = new PublicKey('HyBFBV4nBRN8Hr9V1N21X2qrDr5ZRsmu9CKvWTtEf49K');
    const usdc = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    const expected = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), usdc.toBuffer()],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
    )[0];
    expect(associatedTokenAddress(owner, usdc)).toEqual(expected);
    expect(associatedTokenAddress(owner, usdc, TOKEN_2022_PROGRAM_ID)).not.toEqual(expected);
    const hold = holdPda(owner, 1n);
    expect(vaultAddress(hold, usdc)).toEqual(associatedTokenAddress(hold, usdc));
  });
});

describe('account decoding', () => {
  it('decodes a hold', () => {
    const address = holdPda(sender, 42n);
    const hold = decodeHold(address, holdBytes());
    expect(hold.address).toEqual(address);
    expect(hold.sender).toEqual(sender);
    expect(hold.recipient).toEqual(recipient);
    expect(hold.mint).toEqual(mint);
    expect(hold.amount).toBe(25_000_000n);
    expect(hold.createdAt).toBe(1_800_000_000);
    expect(hold.releaseAt).toBe(1_800_001_800);
    expect(hold.tier).toBe(Tier.SUSPICIOUS);
    expect(Array.from(hold.evidenceHash)).toEqual(Array.from(hash));
    expect(hold.status).toBe(HoldStatus.PENDING);
    expect(hold.nonce).toBe(42n);
    expect(hold.bump).toBe(254);
    expect(hold.isSol).toBe(false);
  });

  it('marks native SOL holds', () => {
    const hold = decodeHold(sender, holdBytes({ mint: PublicKey.default }));
    expect(hold.isSol).toBe(true);
  });

  it('rejects data with another discriminator', () => {
    const bytes = holdBytes();
    bytes[0] = bytes[0]! ^ 0xff;
    expect(() => decodeHold(sender, bytes)).toThrow(/not a Hold/);
    expect(() => decodeConfig(holdBytes())).toThrow(/not a Config/);
  });

  it('decodes config and stats', () => {
    const config: number[] = [...accountDiscriminator('Config')];
    encodeType(
      { defined: { name: 'Config' } },
      {
        admin: sender,
        relayer: recipient,
        riskOracle: mint,
        minWindowSecs: 0,
        defaultWindowSecs: 1_800,
        maxWindowSecs: 259_200,
        paused: true,
        bump: 255,
      },
      config,
    );
    expect(decodeConfig(Uint8Array.from(config))).toMatchObject({
      minWindowSecs: 0,
      defaultWindowSecs: 1_800,
      maxWindowSecs: 259_200,
      paused: true,
    });

    const stats: number[] = [...accountDiscriminator('SubjectStats')];
    encodeType(
      { defined: { name: 'SubjectStats' } },
      {
        subject: recipient,
        flags: 3,
        holdsReceived: 10,
        holdsReclaimedAgainst: 7,
        holdsReleasedTo: 2,
        bump: 1,
      },
      stats,
    );
    expect(decodeSubjectStats(Uint8Array.from(stats))).toMatchObject({
      flags: 3,
      holdsReceived: 10,
      holdsReclaimedAgainst: 7,
      holdsReleasedTo: 2,
    });
  });

  it('encodes base58 for memcmp filters', () => {
    expect(encodeBase58(Uint8Array.of(0))).toBe('1');
    expect(encodeBase58(sender.toBytes())).toBe(sender.toBase58());
  });
});

describe('instruction builders', () => {
  const spec = (name: string) => IDL.instructions.find((ix) => ix.name === name)!;

  it('create_hold: discriminator, argument layout and account order', () => {
    const ix = instructions.createHold({
      sender,
      recipient,
      mint,
      nonce: 42n,
      amount: 25_000_000n,
      windowSecs: 1_800,
      tier: Tier.UNKNOWN,
      evidenceHash: hash,
    });
    const expected = [
      ...spec('create_hold').discriminator,
      ...u64(42n),
      ...u64(25_000_000n),
      0x08,
      0x07,
      0,
      0, // 1800 as u32 LE
      Tier.UNKNOWN,
      ...hash,
    ];
    expect(Array.from(ix.data)).toEqual(expected);
    expect(ix.programId).toEqual(PROGRAM_ID);

    const hold = holdPda(sender, 42n);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual(
      [
        sender,
        recipient,
        configPda(),
        mint,
        associatedTokenAddress(sender, mint),
        hold,
        vaultAddress(hold, mint),
        statsPda(recipient),
        TOKEN_PROGRAM_ID,
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
        SystemProgram.programId,
      ].map((k) => k.toBase58()),
    );
    expect(ix.keys[0]).toMatchObject({ isSigner: true, isWritable: true });
    expect(ix.keys[1]).toMatchObject({ isSigner: false, isWritable: false });
    expect(ix.keys.filter((k) => k.isSigner)).toHaveLength(1);
  });

  it('uses the Token-2022 program for vault and token accounts when asked', () => {
    const ix = instructions.createHold({
      sender,
      recipient,
      mint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      nonce: 1n,
      amount: 1n,
      windowSecs: 60,
      tier: 1,
      evidenceHash: hash,
    });
    expect(ix.keys[4]!.pubkey).toEqual(associatedTokenAddress(sender, mint, TOKEN_2022_PROGRAM_ID));
    expect(ix.keys[8]!.pubkey).toEqual(TOKEN_2022_PROGRAM_ID);
  });

  it('reclaim and release choose the SOL or token instruction from the hold', () => {
    const token: Hold = decodeHold(holdPda(sender, 42n), holdBytes());
    const sol: Hold = decodeHold(holdPda(sender, 43n), holdBytes({ mint: PublicKey.default }));

    const d = (ix: { data: Buffer }) => Array.from(ix.data);
    expect(d(instructions.reclaim({ authority: sender, hold: token }))).toEqual(
      spec('reclaim').discriminator,
    );
    expect(d(instructions.reclaim({ authority: sender, hold: sol }))).toEqual(
      spec('reclaim_sol').discriminator,
    );
    expect(d(instructions.release({ caller: recipient, hold: token }))).toEqual(
      spec('release').discriminator,
    );
    expect(d(instructions.release({ caller: sender, hold: token, early: true }))).toEqual(
      spec('release_early').discriminator,
    );
    expect(d(instructions.release({ caller: recipient, hold: sol }))).toEqual(
      spec('release_sol').discriminator,
    );
    expect(d(instructions.release({ caller: sender, hold: sol, early: true }))).toEqual(
      spec('release_early_sol').discriminator,
    );

    // The refund always targets the sender's own token account.
    const refund = instructions.reclaim({ authority: recipient, hold: token });
    expect(refund.keys[5]!.pubkey).toEqual(associatedTokenAddress(sender, mint));
  });

  it('encodes optional config fields', () => {
    const ix = instructions.updateConfig({ admin: sender, args: { paused: true } });
    const data = Array.from(ix.data).slice(8);
    // six `None` options, then Some(true)
    expect(data).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('builds every instruction in the IDL', () => {
    const hold: Hold = decodeHold(holdPda(sender, 42n), holdBytes());
    const built = [
      instructions.initializeConfig({
        admin: sender,
        relayer: recipient,
        riskOracle: mint,
        minWindowSecs: 0,
        defaultWindowSecs: 1_800,
        maxWindowSecs: 259_200,
      }),
      instructions.createHoldSol({
        sender,
        recipient,
        nonce: 1n,
        amount: 1_000_000n,
        windowSecs: 60,
        tier: 1,
        evidenceHash: hash,
      }),
      instructions.instantTransfer({ sender, recipient, mint, amount: 5n }),
      instructions.instantTransferSol({ sender, recipient, amount: 5n }),
      instructions.initDepositBox({ payer: sender, owner: recipient, mint }),
      instructions.openHoldFromDeposit({
        relayer: sender,
        owner: recipient,
        recipient: mint,
        mint,
        nonce: 2n,
        amount: 3n,
        windowSecs: 1_800,
        tier: 2,
        evidenceHash: hash,
      }),
      instructions.withdrawDeposit({ authority: sender, owner: recipient, mint, amount: 1n }),
      instructions.extendWindow({
        riskOracle: sender,
        hold: hold.address,
        newReleaseAt: 1_800_090_000,
        tier: 3,
        evidenceHash: hash,
      }),
      instructions.setTrust({ sender, recipient }),
      instructions.removeTrust({ sender, recipient }),
      instructions.flagSubject({
        reporter: sender,
        subject: recipient,
        reason: 1,
        evidenceHash: hash,
      }),
      instructions.closeHold({ caller: recipient, hold }),
    ];
    for (const ix of built) {
      expect(ix.data.length).toBeGreaterThanOrEqual(8);
      expect(ix.keys.length).toBeGreaterThan(0);
    }
  });

  it('refuses out-of-range and missing values', () => {
    const base = {
      sender,
      recipient,
      mint,
      nonce: 1n,
      windowSecs: 60,
      tier: 1,
      evidenceHash: hash,
    };
    expect(() => instructions.createHold({ ...base, amount: -1n })).toThrow(/u64/);
    expect(() => instructions.createHold({ ...base, amount: 1n, tier: 300 })).toThrow(/u8/);
    expect(() =>
      instructions.createHold({ ...base, amount: 1n, evidenceHash: new Uint8Array(31) }),
    ).toThrow(/32 elements/);
  });

  it('converts to the kit instruction shape', () => {
    const kit = toKitInstruction(instructions.setTrust({ sender, recipient }));
    expect(kit.programAddress).toBe(PROGRAM_ID.toBase58());
    expect(kit.accounts.map((a) => a.role)).toEqual([3, 0, 1, 0]);
    expect(kit.data).toBeInstanceOf(Uint8Array);
  });
});

describe('events', () => {
  function eventBytes(name: string, value: Record<string, unknown>): Uint8Array {
    const out: number[] = [...IDL.events.find((e) => e.name === name)!.discriminator];
    encodeType({ defined: { name } }, value, out);
    return Uint8Array.from(out);
  }

  const reclaimed = eventBytes('HoldReclaimed', {
    hold: mint,
    sender,
    recipient,
    mint,
    amount: 7n,
    timestamp: 1_800_000_100n,
    tier: 3,
    by: sender,
  });
  const line = `Program data: ${Buffer.from(reclaimed).toString('base64')}`;
  const id = PROGRAM_ID.toBase58();

  it('decodes an event payload', () => {
    const event = decodeEvent(reclaimed);
    expect(event?.name).toBe('HoldReclaimed');
    if (event?.name !== 'HoldReclaimed') throw new Error('wrong event');
    expect(event.data.amount).toBe(7n);
    expect(event.data.by).toEqual(sender);
    expect(event.data.timestamp).toBe(1_800_000_100n);
  });

  it('parses events from logs emitted by the program', () => {
    const logs = [
      `Program ${id} invoke [1]`,
      'Program log: Instruction: Reclaim',
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
      line,
      `Program ${id} success`,
    ];
    expect(parseEvents(logs).map((e) => e.name)).toEqual(['HoldReclaimed']);
  });

  it('ignores the same bytes logged by another program', () => {
    const other = 'ComputeBudget111111111111111111111111111111';
    const logs = [`Program ${other} invoke [1]`, line, `Program ${other} success`];
    expect(parseEvents(logs)).toEqual([]);
    expect(parseEvents(['Program data: not-base64!!', 'Program data: AAAA'])).toEqual([]);
  });
});

describe('evidence hashing', () => {
  const document: EvidenceDocument = {
    policyVersion: '2026.11.1',
    assessedAt: '2026-11-27T12:00:00.000Z',
    sender: sender.toBase58(),
    recipient: recipient.toBase58(),
    mint: 'SOL',
    amount: '1000000000',
    score: 65,
    tier: 'FLAGGED',
    windowSecs: 86_400,
    findings: [
      {
        id: 'reclaimed_against',
        title: 'Senders keep pulling money back',
        points: 40,
        level: 'critical',
        evidence: [0],
      },
    ],
    evidence: [
      {
        source: 'onchain_reputation',
        signal: 'reclaimed_against_ratio',
        weight: 40,
        detail: '7 of 10 holds were undone',
      },
    ],
    unavailable: ['chainabuse'],
  };

  it('is independent of key order and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined })).toBe(
      '{"a":[true,null,"x"],"b":1}',
    );
    const shuffled = Object.fromEntries(
      Object.entries(document).reverse(),
    ) as unknown as EvidenceDocument;
    expect(toHex(hashEvidence(shuffled))).toBe(toHex(hashEvidence(document)));
  });

  it('changes when any field changes', () => {
    const base = toHex(hashEvidence(document));
    expect(toHex(hashEvidence({ ...document, windowSecs: 1_800 }))).not.toBe(base);
    expect(toHex(hashEvidence({ ...document, policyVersion: '2026.11.2' }))).not.toBe(base);
    const edited = structuredClone(document);
    edited.evidence[0]!.detail = '1 of 10 holds were undone';
    expect(toHex(hashEvidence(edited))).not.toBe(base);
  });

  it('verifies against bytes or hex', () => {
    const digest = hashEvidence(document);
    expect(digest).toHaveLength(32);
    expect(verifyEvidence(document, digest)).toBe(true);
    expect(verifyEvidence(document, `0x${toHex(digest).toUpperCase()}`)).toBe(true);
    expect(verifyEvidence({ ...document, score: 10 }, digest)).toBe(false);
    expect(Array.from(fromHex(toHex(digest)))).toEqual(Array.from(digest));
    expect(() => fromHex('xyz')).toThrow();
  });

  it('refuses values JSON cannot represent', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: 1n })).toThrow();
  });
});

describe('explain and formatting', () => {
  const hold = decodeHold(holdPda(sender, 42n), holdBytes());

  it('describes a pending hold with the time left and the reason', () => {
    const text = explain(hold, { now: 1_800_000_000, symbol: 'USDC', decimals: 6 });
    expect(text).toContain('25 USDC is on hold');
    expect(text).toContain('30 minutes');
    expect(text).toContain('warning signs');
  });

  it('describes settled and overdue holds', () => {
    const opts = { now: 1_800_005_000, symbol: 'USDC', decimals: 6 };
    expect(explain(hold, opts)).toContain('can be released now');
    expect(explain({ ...hold, status: HoldStatus.RECLAIMED }, opts)).toContain(
      'returned to the sender',
    );
    expect(explain({ ...hold, status: HoldStatus.RELEASED }, opts)).toContain('was released to');
  });

  it('formats durations and amounts exactly', () => {
    expect(formatDuration(0)).toBe('0 seconds');
    expect(formatDuration(59)).toBe('59 seconds');
    expect(formatDuration(1_800)).toBe('30 minutes');
    expect(formatDuration(90_061)).toBe('1 day 1 hour');
    expect(formatAmount(1_500_000n, 6)).toBe('1.5');
    expect(formatAmount(1n, 9)).toBe('0.000000001');
    expect(formatAmount(12_345_678_901_234_567_890n, 6)).toBe('12345678901234.56789');
    expect(parseAmount('1.5', 6)).toBe(1_500_000n);
    expect(parseAmount('0.000001', 6)).toBe(1n);
    expect(() => parseAmount('0.0000001', 6)).toThrow(/decimal/);
    expect(() => parseAmount('abc', 6)).toThrow();
  });

  it('maps tiers to names and policy windows', () => {
    expect(tierName(Tier.FLAGGED)).toBe('FLAGGED');
    expect(WINDOW_SECS_BY_TIER[Tier.TRUSTED]).toBe(0);
    expect(WINDOW_SECS_BY_TIER[Tier.UNKNOWN]).toBe(1_800);
    expect(WINDOW_SECS_BY_TIER[Tier.SUSPICIOUS]).toBe(21_600);
    expect(WINDOW_SECS_BY_TIER[Tier.FLAGGED]).toBe(86_400);
    expect(WINDOW_SECS_BY_TIER[Tier.SANCTIONED]).toBe(259_200);
  });
});

describe('errors and nonces', () => {
  it('finds program errors in logs, messages and RPC objects', () => {
    const windowOver = IDL.errors.find((e) => e.name === 'WindowOver')!;
    const hex = windowOver.code.toString(16);
    expect(parseProgramError(`failed: custom program error: 0x${hex}`)?.name).toBe('WindowOver');
    expect(parseProgramError(new Error(`custom program error: 0x${hex}`))?.name).toBe('WindowOver');
    expect(parseProgramError({ InstructionError: [0, { Custom: windowOver.code }] })?.name).toBe(
      'WindowOver',
    );
    expect(
      parseProgramError({
        logs: [
          `Program log: AnchorError occurred. Error Code: WindowOver. Error Number: ${windowOver.code}.`,
        ],
      })?.name,
    ).toBe('WindowOver');
    expect(parseProgramError('custom program error: 0x1')).toBeNull();
    expect(errorFromCode(windowOver.code)?.message).toMatch(/window has ended/);
  });

  it('generates distinct u64 nonces', () => {
    const nonces = new Set(Array.from({ length: 500 }, () => newNonce()));
    expect(nonces.size).toBeGreaterThan(490);
    for (const nonce of nonces) expect(nonce < 1n << 64n).toBe(true);
  });
});
