import { ed25519 } from '@noble/curves/ed25519';
import { Ed25519Program, Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
  ASSESSMENT_DOMAIN,
  ASSESSMENT_LEN,
  IDL,
  NATIVE_SOL_MINT,
  PROGRAM_ID,
  assessmentMessage,
  attestationInstruction,
  instructions,
} from '../src';

const sender = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const hash = Uint8Array.from({ length: 32 }, (_, i) => i);

const terms = {
  sender,
  recipient,
  mint,
  amount: 25_000_000n,
  windowSecs: 21_600,
  tier: 2,
  evidenceHash: hash,
  expiresAt: 1_800_000_300,
};

describe('assessment message', () => {
  it('has the layout the program checks', () => {
    const message = assessmentMessage(terms);
    expect(message).toHaveLength(ASSESSMENT_LEN);
    expect(ASSESSMENT_LEN).toBe(203);
    expect(new TextDecoder().decode(message.subarray(0, 22))).toBe(ASSESSMENT_DOMAIN);
    expect(Array.from(message.subarray(22, 54))).toEqual(Array.from(PROGRAM_ID.toBytes()));
    expect(Array.from(message.subarray(54, 86))).toEqual(Array.from(sender.toBytes()));
    expect(Array.from(message.subarray(86, 118))).toEqual(Array.from(recipient.toBytes()));
    expect(Array.from(message.subarray(118, 150))).toEqual(Array.from(mint.toBytes()));
    const view = new DataView(message.buffer);
    expect(view.getBigUint64(150, true)).toBe(25_000_000n);
    expect(view.getUint32(158, true)).toBe(21_600);
    expect(message[162]).toBe(2);
    expect(Array.from(message.subarray(163, 195))).toEqual(Array.from(hash));
    expect(view.getBigInt64(195, true)).toBe(1_800_000_300n);
  });

  it('uses the native-SOL marker for SOL holds', () => {
    const message = assessmentMessage({ ...terms, mint: null });
    expect(Array.from(message.subarray(118, 150))).toEqual(Array.from(NATIVE_SOL_MINT.toBytes()));
  });

  it('changes when any term changes', () => {
    const base = assessmentMessage(terms);
    for (const change of [
      { amount: 25_000_001n },
      { windowSecs: 1_800 },
      { tier: 1 },
      { expiresAt: 1_800_000_301 },
    ]) {
      expect(Array.from(assessmentMessage({ ...terms, ...change }))).not.toEqual(Array.from(base));
    }
  });
});

describe('attested instructions', () => {
  it('builds an Ed25519 check the runtime will verify', () => {
    const oracle = Keypair.generate();
    const message = assessmentMessage(terms);
    const signature = ed25519.sign(message, oracle.secretKey.subarray(0, 32));
    const ix = attestationInstruction(oracle.publicKey, signature, message);
    expect(ix.programId.equals(Ed25519Program.programId)).toBe(true);
    // One signature, everything inside this instruction (index u16::MAX).
    expect(ix.data[0]).toBe(1);
    const view = new DataView(ix.data.buffer, ix.data.byteOffset);
    for (const offset of [4, 8, 14]) expect(view.getUint16(offset, true)).toBe(0xffff);
    expect(ed25519.verify(signature, message, oracle.publicKey.toBytes())).toBe(true);
  });

  it('encodes create_hold_attested with the instructions sysvar', () => {
    const ix = instructions.createHoldAttested({
      ...terms,
      nonce: 7n,
      attestedWindowSecs: 21_600,
    });
    const spec = IDL.instructions.find((i) => i.name === 'create_hold_attested')!;
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(spec.discriminator);
    expect(
      ix.keys[ix.keys.length - 1]!.pubkey.equals(
        new PublicKey('Sysvar1nstructions1111111111111111111111111'),
      ),
    ).toBe(true);
    // nonce, amount, window, attested window, tier, hash, expiry
    expect(ix.data.length).toBe(8 + 8 + 8 + 4 + 4 + 1 + 32 + 8);
  });
});
