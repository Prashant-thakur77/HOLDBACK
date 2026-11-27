/**
 * Localnet integration tests. They run against a real validator through the
 * public SDK, so they cover what the Rust tests cannot: the SDK's builders
 * against the deployed program, real token programs, and events in logs.
 *
 * Time cannot be warped on a validator, so windows here are a few seconds.
 * Exact boundary behaviour is covered by programs/holdback/tests.
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID as SPL_ATA_PROGRAM,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAccount,
  mintTo,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { expect } from 'chai';
import { readFileSync } from 'node:fs';

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  HoldOrigin,
  HoldStatus,
  Tier,
  associatedTokenAddress,
  buildCreateHoldTx,
  depositBoxPda,
  fetchConfig,
  fetchDepositBox,
  fetchHold,
  fetchHoldsByRecipient,
  fetchHoldsBySender,
  fetchSubjectStats,
  fetchTrustedRecipients,
  holdPda,
  instructions,
  isTrusted,
  parseEvents,
  parseProgramError,
  previewTransaction,
  type Hold,
} from '../sdk/src';

const url = process.env.ANCHOR_PROVIDER_URL ?? 'http://127.0.0.1:8899';
const connection = new Connection(url, 'confirmed');
const admin = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(process.env.ANCHOR_WALLET ?? 'keys/deployer.json', 'utf8')),
  ),
);

const HASH = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const AMOUNT = 5_000_000n;
const SHORT = 3; // seconds

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, {
    commitment: 'confirmed',
  });
}

/** Sends and returns the program error name, or fails if it succeeds. */
async function expectError(ixs: TransactionInstruction[], signers: Keypair[], name: string) {
  try {
    await send(ixs, signers);
  } catch (error) {
    const parsed = parseProgramError(error);
    expect(parsed?.name, String(error)).to.equal(name);
    return;
  }
  expect.fail(`expected ${name}, but the transaction succeeded`);
}

async function expectFailure(ixs: TransactionInstruction[], signers: Keypair[]) {
  let failed = false;
  try {
    await send(ixs, signers);
  } catch {
    failed = true;
  }
  expect(failed, 'transaction should fail').to.equal(true);
}

async function funded(sol = 10): Promise<Keypair> {
  const key = Keypair.generate();
  await send(
    [
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: key.publicKey,
        lamports: sol * LAMPORTS_PER_SOL,
      }),
    ],
    [admin],
  );
  return key;
}

async function events(signature: string) {
  const tx = await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  return parseEvents(tx?.meta?.logMessages ?? []);
}

async function tokens(address: PublicKey, program = TOKEN_PROGRAM_ID): Promise<bigint> {
  try {
    return (await getAccount(connection, address, 'confirmed', program)).amount;
  } catch {
    return 0n;
  }
}

async function mustFetch(address: PublicKey): Promise<Hold> {
  const hold = await fetchHold(connection, address);
  if (!hold) throw new Error(`hold ${address.toBase58()} not found`);
  return hold;
}

describe('holdback on localnet', () => {
  const oracle = Keypair.generate();
  const relayer = Keypair.generate();
  let usdc: PublicKey;
  let token22: PublicKey;
  let sender: Keypair;
  let senderToken: PublicKey;
  let nonce = BigInt(Date.now());
  const next = () => ++nonce;

  before(async () => {
    expect(SPL_ATA_PROGRAM.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).to.equal(true);
    await send(
      [oracle, relayer].map((key) =>
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: key.publicKey,
          lamports: 5 * LAMPORTS_PER_SOL,
        }),
      ),
      [admin],
    );

    // A stranger cannot initialize the config; the upgrade authority can.
    const stranger = await funded(1);
    const init = (who: PublicKey) =>
      instructions.initializeConfig({
        admin: who,
        relayer: relayer.publicKey,
        riskOracle: oracle.publicKey,
        minWindowSecs: 0,
        defaultWindowSecs: SHORT,
        maxWindowSecs: 600,
      });
    await expectError([init(stranger.publicKey)], [stranger], 'Unauthorized');
    await send([init(admin.publicKey)], [admin]);

    usdc = await createMint(connection, admin, admin.publicKey, null, 6);
    token22 = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    sender = await funded();
    senderToken = await createAssociatedTokenAccountIdempotent(
      connection,
      admin,
      usdc,
      sender.publicKey,
    );
    await mintTo(connection, admin, usdc, senderToken, admin, 1_000_000_000n);
  });

  it('stores the config', async () => {
    const config = await fetchConfig(connection);
    expect(config?.admin.equals(admin.publicKey)).to.equal(true);
    expect(config?.riskOracle.equals(oracle.publicKey)).to.equal(true);
    expect(config?.relayer.equals(relayer.publicKey)).to.equal(true);
    expect([config?.minWindowSecs, config?.defaultWindowSecs, config?.maxWindowSecs]).to.deep.equal(
      [0, SHORT, 600],
    );
  });

  it('only the admin updates the config, and windows must stay consistent', async () => {
    const stranger = await funded(1);
    await expectError(
      [instructions.updateConfig({ admin: stranger.publicKey, args: { paused: true } })],
      [stranger],
      'Unauthorized',
    );
    await expectError(
      [instructions.updateConfig({ admin: admin.publicKey, args: { maxWindowSecs: 1 } })],
      [admin],
      'InvalidWindowConfig',
    );
  });

  it('previews, creates and reclaims a token hold through buildCreateHoldTx', async () => {
    const recipient = Keypair.generate().publicKey;
    const built = await buildCreateHoldTx(connection, {
      sender: sender.publicKey,
      recipient,
      mint: usdc,
      amount: AMOUNT,
      windowSecs: 120,
      tier: Tier.SUSPICIOUS,
      evidenceHash: HASH,
      nonce: next(),
    });
    expect(built.instant).to.equal(false);

    // Simulate before signing: the card shows exactly what leaves the wallet.
    const preview = await previewTransaction(connection, built.transaction, [
      { owner: sender.publicKey, mint: usdc },
    ]);
    expect(preview.ok, preview.logs.join('\n')).to.equal(true);
    expect(preview.changes[0]?.delta).to.equal(-AMOUNT);

    const before = await tokens(senderToken);
    built.transaction.sign([sender]);
    const signature = await connection.sendTransaction(built.transaction);
    await connection.confirmTransaction(
      { signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight },
      'confirmed',
    );

    const hold = await mustFetch(built.hold!);
    expect(hold.amount).to.equal(AMOUNT);
    expect(hold.tier).to.equal(Tier.SUSPICIOUS);
    expect(hold.origin).to.equal(HoldOrigin.WALLET);
    expect(hold.status).to.equal(HoldStatus.PENDING);
    expect(hold.releaseAt - hold.createdAt).to.equal(120);
    expect(Array.from(hold.evidenceHash)).to.deep.equal(Array.from(HASH));
    expect(await tokens(senderToken)).to.equal(before - AMOUNT);

    const created = (await events(signature)).find((e) => e.name === 'HoldCreated');
    expect(created?.name === 'HoldCreated' && created.data.hold.equals(hold.address)).to.equal(
      true,
    );

    expect(
      (await fetchHoldsBySender(connection, sender.publicKey, { pendingOnly: true })).some((h) =>
        h.address.equals(hold.address),
      ),
    ).to.equal(true);
    expect(
      (await fetchHoldsByRecipient(connection, recipient)).map((h) => h.address.toBase58()),
    ).to.deep.equal([hold.address.toBase58()]);

    // The recipient and a stranger cannot undo it; a release is too early.
    const stranger = await funded(1);
    await expectError(
      [instructions.reclaim({ authority: stranger.publicKey, hold })],
      [stranger],
      'Unauthorized',
    );
    await expectError(
      [instructions.release({ caller: stranger.publicKey, hold })],
      [stranger],
      'WindowNotOver',
    );
    await expectError(
      [instructions.release({ caller: stranger.publicKey, hold, early: true })],
      [stranger],
      'Unauthorized',
    );
    await expectError(
      [instructions.closeHold({ caller: stranger.publicKey, hold })],
      [stranger],
      'HoldStillPending',
    );

    const undo = await send(
      [instructions.reclaim({ authority: sender.publicKey, hold })],
      [sender],
    );
    expect((await events(undo)).map((e) => e.name)).to.deep.equal(['HoldReclaimed']);
    expect(await tokens(senderToken)).to.equal(before);
    expect((await mustFetch(hold.address)).status).to.equal(HoldStatus.RECLAIMED);

    const stats = await fetchSubjectStats(connection, recipient);
    expect([
      stats?.holdsReceived,
      stats?.holdsReclaimedAgainst,
      stats?.holdsReleasedTo,
    ]).to.deep.equal([1, 1, 0]);

    // Anyone closes a settled hold; the rent returns to the sender.
    const lamports = await connection.getBalance(sender.publicKey);
    await send([instructions.closeHold({ caller: stranger.publicKey, hold })], [stranger]);
    expect(await fetchHold(connection, hold.address)).to.equal(null);
    expect(await connection.getBalance(sender.publicKey)).to.be.greaterThan(lamports);
  });

  it('rejects invalid holds', async () => {
    const recipient = Keypair.generate().publicKey;
    const base = {
      sender: sender.publicKey,
      recipient,
      mint: usdc,
      tier: Tier.UNKNOWN,
      evidenceHash: HASH,
    };
    await expectError(
      [instructions.createHold({ ...base, nonce: next(), amount: 0n, windowSecs: 60 })],
      [sender],
      'ZeroAmount',
    );
    await expectError(
      [instructions.createHold({ ...base, nonce: next(), amount: 1n, windowSecs: 0 })],
      [sender],
      'WindowTooShort',
    );
    await expectError(
      [instructions.createHold({ ...base, nonce: next(), amount: 1n, windowSecs: 601 })],
      [sender],
      'WindowTooLong',
    );
    await expectError(
      [instructions.createHold({ ...base, nonce: next(), amount: 1n, windowSecs: 60, tier: 9 })],
      [sender],
      'InvalidTier',
    );
    await expectError(
      [
        instructions.createHold({
          ...base,
          recipient: sender.publicKey,
          nonce: next(),
          amount: 1n,
          windowSecs: 60,
        }),
      ],
      [sender],
      'SelfTransfer',
    );
  });

  it('releases to the recipient after the window, cranked by a stranger', async () => {
    const recipient = Keypair.generate().publicKey;
    const n = next();
    await send(
      [
        instructions.createHold({
          sender: sender.publicKey,
          recipient,
          mint: usdc,
          nonce: n,
          amount: AMOUNT,
          windowSecs: SHORT,
          tier: Tier.UNKNOWN,
          evidenceHash: HASH,
        }),
      ],
      [sender],
    );
    const hold = await mustFetch(holdPda(sender.publicKey, n));
    await sleep((SHORT + 2) * 1000);

    await expectError(
      [instructions.reclaim({ authority: sender.publicKey, hold })],
      [sender],
      'WindowOver',
    );

    const cranker = await funded(1);
    // A crank that names itself as the recipient is refused.
    const forged = instructions.release({
      caller: cranker.publicKey,
      hold: { ...hold, recipient: cranker.publicKey },
    });
    await expectFailure([forged], [cranker]);

    const signature = await send(
      [instructions.release({ caller: cranker.publicKey, hold })],
      [cranker],
    );
    const released = (await events(signature)).find((e) => e.name === 'HoldReleased');
    expect(released?.name === 'HoldReleased' && released.data.early).to.equal(false);
    expect(await tokens(associatedTokenAddress(recipient, usdc))).to.equal(AMOUNT);
    expect((await fetchSubjectStats(connection, recipient))?.holdsReleasedTo).to.equal(1);
  });

  it('lets only the sender release early', async () => {
    const recipient = Keypair.generate().publicKey;
    const n = next();
    await send(
      [
        instructions.createHold({
          sender: sender.publicKey,
          recipient,
          mint: usdc,
          nonce: n,
          amount: AMOUNT,
          windowSecs: 300,
          tier: Tier.UNKNOWN,
          evidenceHash: HASH,
        }),
      ],
      [sender],
    );
    const hold = await mustFetch(holdPda(sender.publicKey, n));
    await expectError(
      [instructions.release({ caller: relayer.publicKey, hold, early: true })],
      [relayer],
      'Unauthorized',
    );
    await send([instructions.release({ caller: sender.publicKey, hold, early: true })], [sender]);
    expect(await tokens(associatedTokenAddress(recipient, usdc))).to.equal(AMOUNT);
  });

  it('lets the oracle extend a window but never shorten it', async () => {
    const recipient = Keypair.generate().publicKey;
    const n = next();
    await send(
      [
        instructions.createHold({
          sender: sender.publicKey,
          recipient,
          mint: usdc,
          nonce: n,
          amount: AMOUNT,
          windowSecs: 60,
          tier: Tier.UNKNOWN,
          evidenceHash: HASH,
        }),
      ],
      [sender],
    );
    const address = holdPda(sender.publicKey, n);
    const hold = await mustFetch(address);
    const extend = (signer: PublicKey, newReleaseAt: number, tier: number) =>
      instructions.extendWindow({
        riskOracle: signer,
        hold: address,
        newReleaseAt,
        tier,
        evidenceHash: HASH.map((b) => b ^ 0xff),
      });

    await expectError(
      [extend(sender.publicKey, hold.releaseAt + 60, Tier.FLAGGED)],
      [sender],
      'Unauthorized',
    );
    await expectError(
      [extend(oracle.publicKey, hold.releaseAt - 1, Tier.FLAGGED)],
      [oracle],
      'WindowCannotShrink',
    );
    await expectError(
      [extend(oracle.publicKey, hold.createdAt + 601, Tier.FLAGGED)],
      [oracle],
      'WindowTooLong',
    );
    await expectError(
      [extend(oracle.publicKey, hold.releaseAt, Tier.TRUSTED)],
      [oracle],
      'TierCannotDrop',
    );

    const vault = associatedTokenAddress(address, usdc);
    const signature = await send(
      [extend(oracle.publicKey, hold.createdAt + 500, Tier.FLAGGED)],
      [oracle],
    );
    const extended = (await events(signature)).find((e) => e.name === 'WindowExtended');
    expect(extended?.name === 'WindowExtended' && Number(extended.data.newReleaseAt)).to.equal(
      hold.createdAt + 500,
    );
    const after = await mustFetch(address);
    expect([after.releaseAt, after.tier]).to.deep.equal([hold.createdAt + 500, Tier.FLAGGED]);
    expect(await tokens(vault)).to.equal(AMOUNT);

    await send([instructions.reclaim({ authority: sender.publicKey, hold: after })], [sender]);
  });

  it('pays trusted recipients instantly and nobody else', async () => {
    const friend = Keypair.generate().publicKey;
    const params = {
      sender: sender.publicKey,
      recipient: friend,
      mint: usdc,
      amount: AMOUNT,
      windowSecs: 0,
      tier: Tier.TRUSTED,
      evidenceHash: HASH,
    };

    const untrusted = await buildCreateHoldTx(connection, params);
    expect(untrusted.instant).to.equal(true);
    const preview = await previewTransaction(connection, untrusted.transaction, [
      { owner: sender.publicKey, mint: usdc },
    ]);
    expect(preview.ok).to.equal(false);

    const set = await send(
      [instructions.setTrust({ sender: sender.publicKey, recipient: friend })],
      [sender],
    );
    expect((await events(set)).map((e) => e.name)).to.deep.equal(['TrustSet']);
    expect(await isTrusted(connection, sender.publicKey, friend)).to.equal(true);
    expect(
      (await fetchTrustedRecipients(connection, sender.publicKey)).map((t) =>
        t.recipient.toBase58(),
      ),
    ).to.include(friend.toBase58());

    const built = await buildCreateHoldTx(connection, params);
    built.transaction.sign([sender]);
    const signature = await connection.sendTransaction(built.transaction);
    await connection.confirmTransaction(
      { signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight },
      'confirmed',
    );
    expect((await events(signature)).map((e) => e.name)).to.deep.equal(['InstantTransfer']);
    expect(await tokens(associatedTokenAddress(friend, usdc))).to.equal(AMOUNT);

    await send(
      [
        instructions.instantTransferSol({
          sender: sender.publicKey,
          recipient: friend,
          amount: 10_000_000n,
        }),
      ],
      [sender],
    );
    expect(await connection.getBalance(friend)).to.equal(10_000_000);

    await send(
      [instructions.removeTrust({ sender: sender.publicKey, recipient: friend })],
      [sender],
    );
    expect(await isTrusted(connection, sender.publicKey, friend)).to.equal(false);
    await expectFailure(
      [
        instructions.instantTransfer({
          sender: sender.publicKey,
          recipient: friend,
          mint: usdc,
          amount: 1n,
        }),
      ],
      [sender],
    );
  });

  it('holds, reclaims and releases native SOL', async () => {
    const recipient = Keypair.generate().publicKey;
    const base = { sender: sender.publicKey, recipient, tier: Tier.UNKNOWN, evidenceHash: HASH };
    await expectError(
      [instructions.createHoldSol({ ...base, nonce: next(), amount: 1_000n, windowSecs: 60 })],
      [sender],
      'AmountBelowRentFloor',
    );

    const first = next();
    await send(
      [instructions.createHoldSol({ ...base, nonce: first, amount: 50_000_000n, windowSecs: 120 })],
      [sender],
    );
    const reclaimable = await mustFetch(holdPda(sender.publicKey, first));
    expect(reclaimable.isSol).to.equal(true);
    const before = await connection.getBalance(sender.publicKey);
    const cranker = await funded(1);
    await expectError(
      [instructions.reclaim({ authority: cranker.publicKey, hold: reclaimable })],
      [cranker],
      'Unauthorized',
    );
    await send(
      [
        instructions.reclaim({ authority: sender.publicKey, hold: reclaimable }),
        instructions.closeHold({ caller: sender.publicKey, hold: reclaimable }),
      ],
      [cranker, sender],
    );
    expect(await connection.getBalance(sender.publicKey)).to.be.greaterThan(before + 50_000_000);

    const second = next();
    await send(
      [
        instructions.createHoldSol({
          ...base,
          nonce: second,
          amount: 50_000_000n,
          windowSecs: SHORT,
        }),
      ],
      [sender],
    );
    const releasable = await mustFetch(holdPda(sender.publicKey, second));
    await expectError(
      [instructions.release({ caller: cranker.publicKey, hold: releasable })],
      [cranker],
      'WindowNotOver',
    );
    await sleep((SHORT + 2) * 1000);
    await send([instructions.release({ caller: cranker.publicKey, hold: releasable })], [cranker]);
    expect(await connection.getBalance(recipient)).to.equal(50_000_000);
  });

  it('supports Token-2022 mints', async () => {
    const recipient = Keypair.generate().publicKey;
    const account = await createAssociatedTokenAccountIdempotent(
      connection,
      admin,
      token22,
      sender.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    await mintTo(
      connection,
      admin,
      token22,
      account,
      admin,
      10n * AMOUNT,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    const built = await buildCreateHoldTx(connection, {
      sender: sender.publicKey,
      recipient,
      mint: token22,
      amount: AMOUNT,
      windowSecs: 120,
      tier: Tier.UNKNOWN,
      evidenceHash: HASH,
      nonce: next(),
    });
    built.transaction.sign([sender]);
    const signature = await connection.sendTransaction(built.transaction);
    await connection.confirmTransaction(
      { signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight },
      'confirmed',
    );

    const hold = await mustFetch(built.hold!);
    expect(
      await tokens(
        associatedTokenAddress(hold.address, token22, TOKEN_2022_PROGRAM_ID),
        TOKEN_2022_PROGRAM_ID,
      ),
    ).to.equal(AMOUNT);
    await send(
      [
        instructions.reclaim({
          authority: sender.publicKey,
          hold,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        }),
      ],
      [sender],
    );
    expect(await tokens(account, TOKEN_2022_PROGRAM_ID)).to.equal(10n * AMOUNT);
  });

  it('runs the deposit-box flow for a wallet that can only make transfers', async () => {
    const owner = await funded(1);
    const ownerToken = await createAssociatedTokenAccountIdempotent(
      connection,
      admin,
      usdc,
      owner.publicKey,
    );
    const recipient = Keypair.generate().publicKey;

    const opened = await send(
      [
        instructions.initDepositBox({
          payer: relayer.publicKey,
          owner: owner.publicKey,
          mint: usdc,
        }),
      ],
      [relayer],
    );
    expect((await events(opened)).map((e) => e.name)).to.deep.equal(['DepositBoxOpened']);
    const box = await fetchDepositBox(connection, owner.publicKey);
    expect(box?.owner.equals(owner.publicKey)).to.equal(true);

    // The owner's wallet makes a plain token transfer into the box.
    const boxToken = associatedTokenAddress(depositBoxPda(owner.publicKey), usdc);
    await mintTo(connection, admin, usdc, boxToken, admin, 3n * AMOUNT);

    const open = (signer: PublicKey, n: bigint, windowSecs: number) =>
      instructions.openHoldFromDeposit({
        relayer: signer,
        owner: owner.publicKey,
        recipient,
        mint: usdc,
        nonce: n,
        amount: AMOUNT,
        windowSecs,
        tier: Tier.SUSPICIOUS,
        evidenceHash: HASH,
      });
    const stranger = await funded(1);
    await expectError([open(stranger.publicKey, next(), 60)], [stranger], 'Unauthorized');
    await expectError([open(relayer.publicKey, next(), SHORT - 1)], [relayer], 'WindowTooShort');

    const n = next();
    await send([open(relayer.publicKey, n, 120)], [relayer]);
    const hold = await mustFetch(holdPda(owner.publicKey, n));
    expect(hold.sender.equals(owner.publicKey)).to.equal(true);
    expect(hold.origin).to.equal(HoldOrigin.DEPOSIT_BOX);
    expect(hold.rentPayer.equals(relayer.publicKey)).to.equal(true);

    // The relayer cannot release early, and its undo pays the owner.
    await expectError(
      [instructions.release({ caller: relayer.publicKey, hold, early: true })],
      [relayer],
      'Unauthorized',
    );
    await send([instructions.reclaim({ authority: relayer.publicKey, hold })], [relayer]);
    expect(await tokens(ownerToken)).to.equal(AMOUNT);

    // Withdrawals reach the owner only, whoever signs.
    await expectError(
      [
        instructions.withdrawDeposit({
          authority: stranger.publicKey,
          owner: owner.publicKey,
          mint: usdc,
          amount: 1n,
        }),
      ],
      [stranger],
      'Unauthorized',
    );
    const withdrawn = await send(
      [
        instructions.withdrawDeposit({
          authority: relayer.publicKey,
          owner: owner.publicKey,
          mint: usdc,
          amount: AMOUNT,
        }),
      ],
      [relayer],
    );
    expect((await events(withdrawn)).map((e) => e.name)).to.deep.equal(['DepositWithdrawn']);
    await send(
      [
        instructions.withdrawDeposit({
          authority: owner.publicKey,
          owner: owner.publicKey,
          mint: usdc,
          amount: AMOUNT,
        }),
      ],
      [owner],
    );
    expect(await tokens(ownerToken)).to.equal(3n * AMOUNT);
    expect(await tokens(boxToken)).to.equal(0n);
  });

  it('records one flag per reporter and counts them', async () => {
    const subject = Keypair.generate().publicKey;
    const alice = await funded(1);
    const bob = await funded(1);
    const flag = (who: PublicKey, reason: number) =>
      instructions.flagSubject({ reporter: who, subject, reason, evidenceHash: HASH });

    await expectError([flag(alice.publicKey, 99)], [alice], 'InvalidReason');
    const signature = await send([flag(alice.publicKey, 1)], [alice]);
    const flagged = (await events(signature)).find((e) => e.name === 'SubjectFlagged');
    expect(flagged?.name === 'SubjectFlagged' && flagged.data.totalFlags).to.equal(1);
    await expectFailure([flag(alice.publicKey, 2)], [alice]);
    await send([flag(bob.publicKey, 6)], [bob]);
    expect((await fetchSubjectStats(connection, subject))?.flags).to.equal(2);
  });

  it('pauses new holds without blocking refunds', async () => {
    const recipient = Keypair.generate().publicKey;
    const n = next();
    const create = (k: bigint) =>
      instructions.createHold({
        sender: sender.publicKey,
        recipient,
        mint: usdc,
        nonce: k,
        amount: AMOUNT,
        windowSecs: 120,
        tier: Tier.UNKNOWN,
        evidenceHash: HASH,
      });
    await send([create(n)], [sender]);

    await send(
      [instructions.updateConfig({ admin: admin.publicKey, args: { paused: true } })],
      [admin],
    );
    try {
      await expectError([create(next())], [sender], 'Paused');
      const hold = await mustFetch(holdPda(sender.publicKey, n));
      await send([instructions.reclaim({ authority: sender.publicKey, hold })], [sender]);
    } finally {
      await send(
        [instructions.updateConfig({ admin: admin.publicKey, args: { paused: false } })],
        [admin],
      );
    }
    expect((await fetchConfig(connection))?.paused).to.equal(false);
  });
});
