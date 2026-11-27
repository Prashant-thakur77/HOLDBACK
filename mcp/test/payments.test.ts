import { DEVNET_USDC_MINT, holdPda, trustPda, type AssessResponse } from '@holdback/sdk';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
  LAST_VALID_BLOCK_HEIGHT,
  NOW,
  assessment,
  decodeTransaction,
  holdArgs,
  holdFields,
  isUnsigned,
  programInstruction,
  startSession,
} from './harness';

const sender = Keypair.generate();
const recipient = Keypair.generate().publicKey.toBase58();
const USDC = DEVNET_USDC_MINT.toBase58();

const flagged: Partial<AssessResponse> = {
  score: 85,
  findings: [
    { id: 'age', title: 'Wallet is two days old', points: 10, level: 'info', evidence: [1] },
    {
      id: 'reports',
      title: 'Reported for phishing',
      points: 60,
      level: 'critical',
      evidence: [0, 9],
    },
  ],
  evidence: [
    {
      source: 'web_reports',
      signal: 'scam_report',
      weight: 60,
      detail: 'A public report names this address in a phishing case.',
      url: 'https://reports.example/case/1',
      quote: 'sent funds to this address after a fake support call',
    },
    { source: 'helius', signal: 'wallet_age', weight: 10, detail: 'First seen two days ago.' },
  ],
  unavailable: ['chainabuse'],
};

describe('tool listing', () => {
  it('publishes every tool with an input and an output schema', async () => {
    const { client } = await startSession();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'assess_recipient',
      'flag_recipient',
      'get_hold',
      'list_holds',
      'release_early',
      'send_protected_payment',
      'trust_recipient',
      'undo_payment',
      'untrust_recipient',
      'verify_evidence',
    ]);
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema?.type, tool.name).toBe('object');
    }
  });
});

describe('assess_recipient', () => {
  it('returns tier, window, score and the strongest findings with their links', async () => {
    const session = await startSession();
    session.chain.addMint(DEVNET_USDC_MINT, 6);
    session.guardian.next = assessment('FLAGGED', 86_400, flagged);

    const { isError, data } = await session.call('assess_recipient', {
      sender: sender.publicKey.toBase58(),
      recipient,
      mint: USDC,
      amount: '12.5',
      context: 'They said my account will be frozen today',
    });

    expect(isError).toBe(false);
    expect(data).toMatchObject({
      tier: 'FLAGGED',
      score: 85,
      windowSecs: 86_400,
      window: '1 day',
      evidenceHash: session.guardian.next.evidenceHash,
      unavailableSources: ['chainabuse'],
      payable: true,
    });
    // Strongest first; an evidence index with no item behind it is dropped.
    expect(data.topFindings.map((finding: { title: string }) => finding.title)).toEqual([
      'Reported for phishing',
      'Wallet is two days old',
    ]);
    expect(data.topFindings[0].sources).toEqual([
      {
        source: 'web_reports',
        detail: 'A public report names this address in a phishing case.',
        url: 'https://reports.example/case/1',
        quote: 'sent funds to this address after a fake support call',
      },
    ]);
    // The Guardian is asked in base units, with the caller's context.
    expect(session.guardian.assessRequests).toEqual([
      {
        sender: sender.publicKey.toBase58(),
        recipient,
        mint: USDC,
        amount: '12500000',
        context: 'They said my account will be frozen today',
        lang: 'en',
      },
    ]);
    expect(session.chain.blockhashRequests).toBe(0);
  });

  it('marks a sanctioned recipient as not payable', async () => {
    const session = await startSession({ signer: sender });
    session.guardian.next = assessment('SANCTIONED', 259_200);
    const { data } = await session.call('assess_recipient', {
      recipient,
      mint: 'SOL',
      amount: '1',
    });
    expect(data.payable).toBe(false);
    expect(session.guardian.assessRequests[0]).toMatchObject({ mint: null, amount: '1000000000' });
  });

  it('fails closed when no risk service is configured', async () => {
    const session = await startSession({ signer: sender, guardian: false });
    const { isError, data } = await session.call('assess_recipient', {
      recipient,
      mint: 'SOL',
      amount: '1',
    });
    expect(isError).toBe(true);
    expect(data.code).toBe('guardian_unavailable');
  });
});

describe('send_protected_payment', () => {
  it('returns an unsigned create_hold transaction when no key is configured', async () => {
    const session = await startSession();
    session.chain.addMint(DEVNET_USDC_MINT, 6);
    session.guardian.next = assessment('SUSPICIOUS', 21_600);

    const { isError, data } = await session.call('send_protected_payment', {
      sender: sender.publicKey.toBase58(),
      recipient,
      mint: USDC,
      amount: '25',
    });

    expect(isError).toBe(false);
    expect(data).toMatchObject({
      status: 'needs_signature',
      signature: null,
      requiredSigner: sender.publicKey.toBase58(),
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
      path: 'hold',
      mint: USDC,
      amount: '25',
      amountBaseUnits: '25000000',
      windowSecs: 21_600,
      releaseAt: new Date((NOW + 21_600) * 1000).toISOString(),
      releaseAtIsEstimate: true,
    });
    expect(data.assessment.tier).toBe('SUSPICIOUS');
    expect(data.notes.join(' ')).toContain('SUSPICIOUS');

    const transaction = decodeTransaction(data.unsignedTransaction);
    expect(isUnsigned(transaction)).toBe(true);
    expect(transaction.message.staticAccountKeys[0]!.equals(sender.publicKey)).toBe(true);
    const instruction = programInstruction(transaction);
    expect(instruction.name).toBe('create_hold');
    const args = holdArgs(instruction.data);
    expect(args).toMatchObject({
      amount: 25_000_000n,
      windowSecs: 21_600,
      tier: 2,
      evidenceHash: session.guardian.next.evidenceHash,
    });
    expect(data.hold).toBe(holdPda(sender.publicKey, args.nonce).toBase58());
    expect(session.chain.sent).toHaveLength(0);
  });

  it('signs, sends and reads the release time from the chain when a key is configured', async () => {
    const session = await startSession({ signer: sender });
    session.guardian.next = assessment('UNKNOWN', 1_800);
    // The cluster clock, not the local one, sets the release time.
    const clusterReleaseAt = NOW + 1_800 + 7;
    session.chain.onSend = (transaction) => {
      const instruction = programInstruction(transaction);
      const { nonce, amount } = holdArgs(instruction.data);
      session.chain.addHold(
        holdPda(sender.publicKey, nonce),
        holdFields({
          sender: sender.publicKey,
          recipient: new PublicKey(recipient),
          amount,
          nonce,
          releaseAt: BigInt(clusterReleaseAt),
        }),
      );
    };

    const { isError, data } = await session.call('send_protected_payment', {
      recipient,
      mint: 'SOL',
      amount: '0.5',
    });

    expect(isError).toBe(false);
    expect(session.chain.sent).toHaveLength(1);
    const [transaction] = session.chain.sent;
    expect(isUnsigned(transaction!)).toBe(false);
    expect(programInstruction(transaction!).name).toBe('create_hold_sol');
    expect(data).toMatchObject({
      status: 'sent',
      unsignedTransaction: null,
      requiredSigner: sender.publicKey.toBase58(),
      path: 'hold',
      mint: 'SOL',
      amountBaseUnits: '500000000',
      releaseAt: new Date(clusterReleaseAt * 1000).toISOString(),
      releaseAtIsEstimate: false,
    });
    expect(data.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  });

  it('refuses an amount over the cap before assessing or building anything', async () => {
    const session = await startSession({ signer: sender, maxAmount: '100' });
    session.chain.addMint(DEVNET_USDC_MINT, 6);

    const over = await session.call('send_protected_payment', {
      recipient,
      mint: USDC,
      amount: '100.000001',
    });
    expect(over.isError).toBe(true);
    expect(over.data).toMatchObject({
      code: 'amount_over_cap',
      details: { maxAmount: '100', requested: '100.000001' },
    });
    expect(session.guardian.assessRequests).toHaveLength(0);
    expect(session.chain.blockhashRequests).toBe(0);
    expect(session.chain.sent).toHaveLength(0);

    const atCap = await session.call('send_protected_payment', {
      recipient,
      mint: USDC,
      amount: '100',
    });
    expect(atCap.isError).toBe(false);
    expect(session.chain.sent).toHaveLength(1);
  });

  it('refuses a sanctioned recipient outright and builds nothing', async () => {
    const session = await startSession({ signer: sender });
    session.guardian.next = assessment('SANCTIONED', 259_200);

    const { isError, data } = await session.call('send_protected_payment', {
      recipient,
      mint: 'SOL',
      amount: '1',
    });

    expect(isError).toBe(true);
    expect(data.code).toBe('recipient_sanctioned');
    expect(data.details.assessment.tier).toBe('SANCTIONED');
    expect(session.chain.blockhashRequests).toBe(0);
    expect(session.chain.sent).toHaveLength(0);
  });

  it('pays a trusted recipient on the instant path', async () => {
    const session = await startSession();
    session.guardian.next = assessment('TRUSTED', 0);
    const to = new PublicKey(recipient);
    session.chain.addTrust(trustPda(sender.publicKey, to), sender.publicKey, to);

    const { data } = await session.call('send_protected_payment', {
      sender: sender.publicKey.toBase58(),
      recipient,
      mint: 'SOL',
      amount: '1',
    });

    expect(data).toMatchObject({ path: 'instant', hold: null, windowSecs: 0, releaseAt: null });
    expect(programInstruction(decodeTransaction(data.unsignedTransaction)).name).toBe(
      'instant_transfer_sol',
    );
    expect(data.notes.join(' ')).toContain('cannot be undone');
  });

  it('falls back to a hold when the recipient is trusted by history but not on-chain', async () => {
    const session = await startSession();
    session.guardian.next = assessment('TRUSTED', 0);

    const { data } = await session.call('send_protected_payment', {
      sender: sender.publicKey.toBase58(),
      recipient,
      mint: 'SOL',
      amount: '1',
    });

    expect(data).toMatchObject({ path: 'hold', windowSecs: 1_800 });
    const instruction = programInstruction(decodeTransaction(data.unsignedTransaction));
    expect(instruction.name).toBe('create_hold_sol');
    expect(holdArgs(instruction.data)).toMatchObject({ windowSecs: 1_800, tier: 0 });
  });

  it('lets the caller lengthen the window but never shorten it', async () => {
    const session = await startSession();
    session.guardian.next = assessment('UNKNOWN', 1_800);
    const base = { sender: sender.publicKey.toBase58(), recipient, mint: 'SOL', amount: '1' };

    const longer = await session.call('send_protected_payment', { ...base, windowSecs: 7_200 });
    expect(longer.data.windowSecs).toBe(7_200);
    const longerArgs = holdArgs(
      programInstruction(decodeTransaction(longer.data.unsignedTransaction)).data,
    );
    expect(longerArgs.windowSecs).toBe(7_200);

    const shorter = await session.call('send_protected_payment', { ...base, windowSecs: 60 });
    expect(shorter.data.windowSecs).toBe(1_800);
    expect(shorter.data.notes.join(' ')).toContain('never shortened');
  });

  it('needs to know who pays, and refuses to pay as someone else', async () => {
    const unsigned = await startSession();
    const missing = await unsigned.call('send_protected_payment', {
      recipient,
      mint: 'SOL',
      amount: '1',
    });
    expect(missing.data.code).toBe('wallet_required');

    const signed = await startSession({ signer: sender });
    const other = await signed.call('send_protected_payment', {
      sender: Keypair.generate().publicKey.toBase58(),
      recipient,
      mint: 'SOL',
      amount: '1',
    });
    expect(other.data.code).toBe('wallet_mismatch');
    expect(signed.chain.sent).toHaveLength(0);
  });

  it('rejects amounts the mint cannot represent and unknown mints', async () => {
    const session = await startSession({ signer: sender });
    session.chain.addMint(DEVNET_USDC_MINT, 6);

    const tooPrecise = await session.call('send_protected_payment', {
      recipient,
      mint: USDC,
      amount: '1.0000001',
    });
    expect(tooPrecise.data.code).toBe('invalid_amount');

    const zero = await session.call('send_protected_payment', {
      recipient,
      mint: USDC,
      amount: '0',
    });
    expect(zero.data.code).toBe('invalid_amount');

    const unknown = await session.call('send_protected_payment', {
      recipient,
      mint: Keypair.generate().publicKey.toBase58(),
      amount: '1',
    });
    expect(unknown.data.code).toBe('unknown_mint');
  });
});
