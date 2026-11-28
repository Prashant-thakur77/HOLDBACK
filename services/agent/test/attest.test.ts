import { ed25519 } from '@noble/curves/ed25519';
import { Keypair, PublicKey } from '@solana/web3.js';
import { assessmentMessage, fromHex } from '@holdback/sdk';
import { describe, expect, it } from 'vitest';

import { ATTESTATION_TTL_SECS, attest } from '../src/chain/attest';
import type { Subject } from '../src/collectors/types';

const oracle = Keypair.generate();
const env = { ORACLE_KEYPAIR: JSON.stringify(Array.from(oracle.secretKey)) };
const subject: Subject = {
  sender: Keypair.generate().publicKey.toBase58(),
  recipient: Keypair.generate().publicKey.toBase58(),
  mint: null,
  amount: 100_000_000n,
  lang: 'en',
};
const hash = 'ab'.repeat(32);
const now = new Date('2026-11-29T00:00:00Z');

describe('attest', () => {
  it('signs exactly the terms the program checks', () => {
    const attestation = attest(
      env,
      subject,
      { windowSecs: 21_600, tier: 2, evidenceHash: hash },
      now,
    )!;
    expect(attestation.oracle).toBe(oracle.publicKey.toBase58());
    expect(attestation.expiresAt).toBe(Math.floor(now.getTime() / 1000) + ATTESTATION_TTL_SECS);
    const message = assessmentMessage({
      sender: new PublicKey(subject.sender),
      recipient: new PublicKey(subject.recipient),
      mint: null,
      amount: subject.amount,
      windowSecs: 21_600,
      tier: 2,
      evidenceHash: fromHex(hash),
      expiresAt: attestation.expiresAt,
    });
    expect(
      ed25519.verify(fromHex(attestation.signature), message, oracle.publicKey.toBytes()),
    ).toBe(true);
  });

  it('returns nothing without an oracle key, for a zero window, or for bad input', () => {
    expect(
      attest({}, subject, { windowSecs: 1_800, tier: 1, evidenceHash: hash }, now),
    ).toBeUndefined();
    expect(
      attest(env, subject, { windowSecs: 0, tier: 0, evidenceHash: hash }, now),
    ).toBeUndefined();
    expect(
      attest(
        env,
        { ...subject, recipient: 'not-an-address' },
        { windowSecs: 1_800, tier: 1, evidenceHash: hash },
        now,
      ),
    ).toBeUndefined();
  });
});
