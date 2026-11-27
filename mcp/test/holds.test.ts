import { DEVNET_USDC_MINT, HoldStatus, IDL, Tier, toHex, type HoldRecord } from '@holdback/sdk';
import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
  NOW,
  decodeTransaction,
  holdFields,
  isUnsigned,
  programInstruction,
  startSession,
} from './harness';

const sender = Keypair.generate();
const recipient = Keypair.generate().publicKey;
const holdAddress = Keypair.generate().publicKey;
const hold = holdAddress.toBase58();

function mirrorRecord(overrides: Partial<HoldRecord> = {}): HoldRecord {
  return {
    pda: hold,
    sender: sender.publicKey.toBase58(),
    recipient: recipient.toBase58(),
    mint: null,
    amount: '2000000000',
    tier: 'UNKNOWN',
    origin: 'WALLET',
    status: 'RECLAIMED',
    createdAt: new Date((NOW - 3_600) * 1000).toISOString(),
    releaseAt: new Date((NOW - 1_800) * 1000).toISOString(),
    evidenceHash: '07'.repeat(32),
    createSignature: null,
    settleSignature: null,
    ...overrides,
  };
}

describe('get_hold', () => {
  it('reads an open hold from the chain', async () => {
    const session = await startSession();
    session.chain.addMint(DEVNET_USDC_MINT, 6);
    const fields = holdFields({
      sender: sender.publicKey,
      recipient,
      mint: DEVNET_USDC_MINT,
      amount: 25_000_000n,
      tier: Tier.FLAGGED,
    });
    session.chain.addHold(holdAddress, fields);

    const { isError, data } = await session.call('get_hold', { hold });

    expect(isError).toBe(false);
    expect(data).toMatchObject({
      source: 'chain',
      address: hold,
      sender: sender.publicKey.toBase58(),
      recipient: recipient.toBase58(),
      mint: DEVNET_USDC_MINT.toBase58(),
      amount: '25',
      amountBaseUnits: '25000000',
      symbol: 'USDC',
      tier: 'FLAGGED',
      status: 'PENDING',
      origin: 'WALLET',
      releaseAt: new Date((NOW + 1_200) * 1000).toISOString(),
      secondsRemaining: 1_200,
      canUndo: true,
      evidenceHash: toHex(fields.evidenceHash),
    });
    expect(data.summary).toContain('25 USDC is on hold');
  });

  it('falls back to the mirror when the hold account is closed, and says so', async () => {
    const session = await startSession();
    session.guardian.receipts.set(hold, mirrorRecord());

    const { data } = await session.call('get_hold', { hold });

    expect(data).toMatchObject({
      source: 'guardian_mirror',
      status: 'RECLAIMED',
      mint: 'SOL',
      amount: '2',
      canUndo: false,
      secondsRemaining: 0,
    });
    expect(data.summary).toContain('returned to the sender');
  });

  it('reports a hold that exists nowhere', async () => {
    const session = await startSession();
    const { isError, data } = await session.call('get_hold', { hold });
    expect(isError).toBe(true);
    expect(data.code).toBe('hold_not_found');
  });
});

describe('list_holds', () => {
  async function sessionWithHolds() {
    const session = await startSession({ signer: sender });
    const other = Keypair.generate().publicKey;
    session.chain.addHold(
      Keypair.generate().publicKey,
      holdFields({ sender: sender.publicKey, recipient, createdAt: BigInt(NOW - 100), nonce: 1n }),
    );
    session.chain.addHold(
      Keypair.generate().publicKey,
      holdFields({
        sender: sender.publicKey,
        recipient: other,
        createdAt: BigInt(NOW - 50),
        status: HoldStatus.RELEASED,
        nonce: 2n,
      }),
    );
    session.chain.addHold(
      Keypair.generate().publicKey,
      holdFields({ sender: other, recipient, createdAt: BigInt(NOW - 10), nonce: 3n }),
    );
    return session;
  }

  it('lists what the configured wallet sent, newest first', async () => {
    const session = await sessionWithHolds();
    const { data } = await session.call('list_holds');
    expect(data).toMatchObject({
      wallet: sender.publicKey.toBase58(),
      role: 'sender',
      source: 'chain',
      total: 2,
    });
    expect(data.holds.map((item: { status: string }) => item.status)).toEqual([
      'RELEASED',
      'PENDING',
    ]);
  });

  it('filters to pending holds and by recipient', async () => {
    const session = await sessionWithHolds();

    const pending = await session.call('list_holds', { pendingOnly: true });
    expect(pending.data.total).toBe(1);
    expect(pending.data.holds[0].canUndo).toBe(true);

    const incoming = await session.call('list_holds', {
      wallet: recipient.toBase58(),
      role: 'recipient',
      limit: 1,
    });
    expect(incoming.data).toMatchObject({ role: 'recipient', total: 2 });
    expect(incoming.data.holds).toHaveLength(1);
  });

  it('falls back to the mirror when the RPC node refuses account scans', async () => {
    const session = await sessionWithHolds();
    session.chain.scansFail = true;
    session.guardian.records = [mirrorRecord(), mirrorRecord({ status: 'PENDING' })];

    const { data } = await session.call('list_holds', { pendingOnly: true });

    expect(data).toMatchObject({ source: 'guardian_mirror', total: 1 });
    expect(data.holds[0].status).toBe('PENDING');
  });

  it('needs a wallet when no key is configured', async () => {
    const session = await startSession();
    const { data } = await session.call('list_holds');
    expect(data.code).toBe('wallet_required');
  });
});

describe('undo_payment', () => {
  it('builds an unsigned reclaim for the sender when no key is configured', async () => {
    const session = await startSession();
    session.chain.addHold(holdAddress, holdFields({ sender: sender.publicKey, recipient }));

    const { isError, data } = await session.call('undo_payment', { hold });

    expect(isError).toBe(false);
    expect(data).toMatchObject({
      status: 'needs_signature',
      requiredSigner: sender.publicKey.toBase58(),
      hold,
      mint: 'SOL',
      amount: '2',
    });
    const transaction = decodeTransaction(data.unsignedTransaction);
    expect(isUnsigned(transaction)).toBe(true);
    const instruction = programInstruction(transaction);
    expect(instruction.name).toBe('reclaim_sol');
    expect(instruction.accounts.some((key) => key.equals(holdAddress))).toBe(true);
  });

  it('signs and sends a token reclaim with the configured key', async () => {
    const session = await startSession({ signer: sender });
    session.chain.addMint(DEVNET_USDC_MINT, 6);
    session.chain.addHold(
      holdAddress,
      holdFields({
        sender: sender.publicKey,
        recipient,
        mint: DEVNET_USDC_MINT,
        amount: 5_000_000n,
      }),
    );

    const { data } = await session.call('undo_payment', { hold });

    expect(data).toMatchObject({ status: 'sent', amount: '5', unsignedTransaction: null });
    expect(data.outcome).toContain('Returns 5 USDC');
    expect(session.chain.sent).toHaveLength(1);
    expect(programInstruction(session.chain.sent[0]!).name).toBe('reclaim');
  });

  it('refuses once the window is over, for a settled hold, and for a non-sender key', async () => {
    const late = await startSession();
    late.chain.addHold(
      holdAddress,
      holdFields({ sender: sender.publicKey, recipient, releaseAt: BigInt(NOW - 120) }),
    );
    expect((await late.call('undo_payment', { hold })).data.code).toBe('window_over');

    const settled = await startSession();
    settled.chain.addHold(
      holdAddress,
      holdFields({ sender: sender.publicKey, recipient, status: HoldStatus.RELEASED }),
    );
    expect((await settled.call('undo_payment', { hold })).data.code).toBe('hold_not_pending');

    const stranger = await startSession({ signer: Keypair.generate() });
    stranger.chain.addHold(holdAddress, holdFields({ sender: sender.publicKey, recipient }));
    expect((await stranger.call('undo_payment', { hold })).data.code).toBe('not_sender');
    expect(stranger.chain.sent).toHaveLength(0);

    const missing = await startSession();
    expect((await missing.call('undo_payment', { hold })).data.code).toBe('hold_not_found');
  });

  it('reports the program’s own error when the chain refuses', async () => {
    const session = await startSession({ signer: sender });
    session.chain.addHold(holdAddress, holdFields({ sender: sender.publicKey, recipient }));
    const windowOver = IDL.errors.find((error) => error.name === 'WindowOver')!;
    session.chain.sendFailure = new Error(
      `Transaction simulation failed: custom program error: 0x${windowOver.code.toString(16)}`,
    );

    const { isError, data } = await session.call('undo_payment', { hold });

    expect(isError).toBe(true);
    expect(data.code).toBe('program_refused');
    expect(data.message).toContain(windowOver.msg);
  });
});

describe('release_early', () => {
  it('will not run without the explicit acknowledgement', async () => {
    const session = await startSession({ signer: sender });
    session.chain.addHold(holdAddress, holdFields({ sender: sender.publicKey, recipient }));

    const { isError, text } = await session.call('release_early', { hold });

    expect(isError).toBe(true);
    expect(text).toContain('acknowledgeIrreversible');
    expect(session.chain.sent).toHaveLength(0);
  });

  it('releases before the window ends with the sender’s authority', async () => {
    const session = await startSession({ signer: sender });
    session.chain.addHold(holdAddress, holdFields({ sender: sender.publicKey, recipient }));

    const { data } = await session.call('release_early', { hold, acknowledgeIrreversible: true });

    expect(data.status).toBe('sent');
    expect(data.outcome).toContain('final');
    expect(programInstruction(session.chain.sent[0]!).name).toBe('release_early_sol');
  });

  it('uses the plain release once the window is over', async () => {
    const session = await startSession();
    session.chain.addMint(DEVNET_USDC_MINT, 6);
    session.chain.addHold(
      holdAddress,
      holdFields({
        sender: sender.publicKey,
        recipient,
        mint: DEVNET_USDC_MINT,
        releaseAt: BigInt(NOW - 1),
      }),
    );

    const { data } = await session.call('release_early', { hold, acknowledgeIrreversible: true });

    expect(data.status).toBe('needs_signature');
    expect(programInstruction(decodeTransaction(data.unsignedTransaction)).name).toBe('release');
  });
});
