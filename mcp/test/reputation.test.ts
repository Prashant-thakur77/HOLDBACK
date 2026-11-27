import { PROGRAM_ID, flagPda, toHex, trustPda } from '@holdback/sdk';
import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { decodeTransaction, programInstruction, startSession } from './harness';

const sender = Keypair.generate();
const recipient = Keypair.generate().publicKey;

describe('trust_recipient and untrust_recipient', () => {
  it('requires the acknowledgement before trusting', async () => {
    const session = await startSession({ signer: sender });
    const { isError, text } = await session.call('trust_recipient', {
      recipient: recipient.toBase58(),
    });
    expect(isError).toBe(true);
    expect(text).toContain('acknowledgeIrreversible');
  });

  it('creates the trust record, then reports no change when it already exists', async () => {
    const session = await startSession({ signer: sender });
    const args = { recipient: recipient.toBase58(), acknowledgeIrreversible: true };

    const first = await session.call('trust_recipient', args);
    expect(first.data).toMatchObject({
      status: 'sent',
      sender: sender.publicKey.toBase58(),
      recipient: recipient.toBase58(),
      trustedNow: true,
    });
    const instruction = programInstruction(session.chain.sent[0]!);
    expect(instruction.name).toBe('set_trust');
    expect(instruction.accounts[2]!.equals(trustPda(sender.publicKey, recipient))).toBe(true);

    session.chain.addTrust(trustPda(sender.publicKey, recipient), sender.publicKey, recipient);
    const second = await session.call('trust_recipient', args);
    expect(second.data).toMatchObject({ status: 'no_change', trustedNow: true, signature: null });
    expect(session.chain.sent).toHaveLength(1);
  });

  it('removes trust with an unsigned transaction when no key is configured', async () => {
    const session = await startSession();
    const args = { sender: sender.publicKey.toBase58(), recipient: recipient.toBase58() };

    const nothing = await session.call('untrust_recipient', args);
    expect(nothing.data).toMatchObject({ status: 'no_change', trustedNow: false });

    session.chain.addTrust(trustPda(sender.publicKey, recipient), sender.publicKey, recipient);
    const removal = await session.call('untrust_recipient', args);
    expect(removal.data).toMatchObject({ status: 'needs_signature', trustedNow: true });
    expect(programInstruction(decodeTransaction(removal.data.unsignedTransaction)).name).toBe(
      'remove_trust',
    );
  });
});

describe('flag_recipient', () => {
  it('files a report with the reason code and evidence hash', async () => {
    const session = await startSession({ signer: sender });
    const evidenceHash = 'ab'.repeat(32);

    const { isError, data } = await session.call('flag_recipient', {
      subject: recipient.toBase58(),
      reason: 'FAKE_SUPPORT',
      evidenceHash,
    });

    expect(isError).toBe(false);
    expect(data).toMatchObject({
      status: 'sent',
      reporter: sender.publicKey.toBase58(),
      subject: recipient.toBase58(),
      reason: 'FAKE_SUPPORT',
      flag: flagPda(sender.publicKey, recipient).toBase58(),
    });
    const instruction = programInstruction(session.chain.sent[0]!);
    expect(instruction.name).toBe('flag_subject');
    expect(instruction.data[0]).toBe(5);
    expect(toHex(instruction.data.subarray(1, 33))).toBe(evidenceHash);
  });

  it('does not build a second report from the same reporter', async () => {
    const session = await startSession({ signer: sender });
    session.chain.set(flagPda(sender.publicKey, recipient), PROGRAM_ID, new Uint8Array(90));

    const { data } = await session.call('flag_recipient', {
      subject: recipient.toBase58(),
      reason: 'PHISHING',
    });

    expect(data.status).toBe('no_change');
    expect(session.chain.sent).toHaveLength(0);
  });

  it('rejects a reason outside the closed list', async () => {
    const session = await startSession({ signer: sender });
    const { isError } = await session.call('flag_recipient', {
      subject: recipient.toBase58(),
      reason: 'ANNOYING',
    });
    expect(isError).toBe(true);
  });
});
