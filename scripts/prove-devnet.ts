/**
 * Proves the program's behaviour on devnet, in public.
 *
 * Every instruction runs once on its happy path, and every attack below is
 * sent with preflight disabled so the refusal lands on-chain as a failed
 * transaction anyone can open in an explorer. The result, with every
 * signature and error, is written to proofs/devnet.json and proofs/DEVNET.md.
 *
 *   npx tsx scripts/prove-devnet.ts
 *
 * Needs keys/deployer.json (pays for everything, about 0.3 SOL, returned at the
 * end except fees and rent of accounts that stay open), keys/oracle.json and
 * keys/relayer.json (the service keys in the on-chain config), and
 * HELIUS_DEVNET_RPC or HELIUS_API_KEY in .env (the public RPC also works, slower).
 * Test tokens are minted fresh by this script; no third-party token is used.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

import { ed25519 } from '@noble/curves/ed25519';

import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAccount,
  mintTo,
  transfer,
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

import {
  PROGRAM_ID,
  Tier,
  assessmentMessage,
  attestationInstruction,
  associatedTokenAddress,
  depositBoxPda,
  fetchConfig,
  fetchHold,
  holdPda,
  instructions,
  parseProgramError,
  type Hold,
} from '../sdk/src';

type Outcome = 'executed' | 'refused';

interface Proof {
  id: string;
  kind: 'happy path' | 'attack';
  description: string;
  expected: string;
  outcome: Outcome;
  error: string | null;
  signature: string;
  explorer: string;
}

function env(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync('.env', 'utf8')
        .split('\n')
        .filter((line) => line.includes('=') && !line.startsWith('#'))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
  } catch {
    return {};
  }
}

const vars = env();
const RPC =
  process.env.HELIUS_DEVNET_RPC ||
  vars.HELIUS_DEVNET_RPC ||
  (vars.HELIUS_API_KEY
    ? `https://devnet.helius-rpc.com/?api-key=${vars.HELIUS_API_KEY}`
    : 'https://api.devnet.solana.com');
const connection = new Connection(RPC, 'confirmed');
const keypair = (path: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));

const deployer = keypair('keys/deployer.json');
const oracle = keypair('keys/oracle.json');
const relayer = keypair('keys/relayer.json');
const HASH = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
const proofs: Proof[] = [];
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let nonce = BigInt(Date.now()) * 1000n;
const next = () => ++nonce;

async function send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, {
    commitment: 'confirmed',
  });
}

/** A step that must succeed. */
async function happy(
  id: string,
  description: string,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): Promise<string> {
  const signature = await send(ixs, signers);
  proofs.push({
    id,
    kind: 'happy path',
    description,
    expected: 'executes',
    outcome: 'executed',
    error: null,
    signature,
    explorer: explorer(signature),
  });
  console.log(`ok      ${id}  ${signature}`);
  return signature;
}

/**
 * A transaction that must be refused. It is sent without preflight so the
 * failure is recorded on-chain, then the program error is read back from the
 * transaction's logs. Anything other than a refusal stops the run.
 */
async function attack(
  id: string,
  description: string,
  expected: string,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): Promise<void> {
  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0]!.publicKey;
  tx.sign(...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

  let landed = await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  for (let i = 0; !landed && i < 10; i++) {
    await sleep(1500);
    landed = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
  }
  const err = landed?.meta?.err ?? null;
  if (err === null) throw new Error(`${id}: the attack executed; the program must refuse it`);
  const logs = landed?.meta?.logMessages ?? [];
  const program = parseProgramError({ logs, err });
  const anchor = logs.join('\n').match(/Error Code: (\w+)/)?.[1];
  // Same labels as scripts/verify-proofs.ts, so the record and the check agree.
  const error =
    anchor ??
    program?.name ??
    (logs.some((line) => /already in use/.test(line))
      ? 'AccountAlreadyInUse (system program)'
      : JSON.stringify(err));
  proofs.push({
    id,
    kind: 'attack',
    description,
    expected,
    outcome: 'refused',
    error,
    signature,
    explorer: explorer(signature),
  });
  console.log(`refused ${id}  ${error}  ${signature}`);
}

async function hold(address: PublicKey): Promise<Hold> {
  for (let i = 0; i < 10; i++) {
    const found = await fetchHold(connection, address);
    if (found) return found;
    await sleep(1000);
  }
  throw new Error(`hold ${address.toBase58()} not found`);
}

async function funded(lamports: number): Promise<Keypair> {
  const key = Keypair.generate();
  await send(
    [SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: key.publicKey, lamports })],
    [deployer],
  );
  return key;
}

async function main() {
  const config = await fetchConfig(connection);
  if (!config) throw new Error('config not initialized on this cluster');
  if (!config.riskOracle.equals(oracle.publicKey) || !config.relayer.equals(relayer.publicKey)) {
    throw new Error('keys/oracle.json or keys/relayer.json do not match the on-chain config');
  }
  console.log(`program ${PROGRAM_ID.toBase58()} on ${new URL(RPC).host}`);

  const sender = await funded(0.12 * LAMPORTS_PER_SOL);
  const attacker = await funded(0.03 * LAMPORTS_PER_SOL);
  const owner = await funded(0.02 * LAMPORTS_PER_SOL);
  const recipient = Keypair.generate().publicKey;
  const friend = Keypair.generate().publicKey;
  const subject = Keypair.generate().publicKey;

  // Test tokens: one classic SPL mint and one Token-2022 mint, minted here.
  const usdc = await createMint(connection, deployer, deployer.publicKey, null, 6);
  const t22 = await createMint(
    connection,
    deployer,
    deployer.publicKey,
    null,
    6,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  const senderToken = await createAssociatedTokenAccountIdempotent(
    connection,
    deployer,
    usdc,
    sender.publicKey,
  );
  const sender22 = await createAssociatedTokenAccountIdempotent(
    connection,
    deployer,
    t22,
    sender.publicKey,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  const attackerToken = await createAssociatedTokenAccountIdempotent(
    connection,
    deployer,
    usdc,
    attacker.publicKey,
  );
  await mintTo(connection, deployer, usdc, senderToken, deployer, 1_000_000_000n);
  await mintTo(
    connection,
    deployer,
    t22,
    sender22,
    deployer,
    100_000_000n,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  const AMOUNT = 25_000_000n; // 25 test tokens
  const create = (n: bigint, windowSecs: number, mint = usdc, tokenProgram = TOKEN_PROGRAM_ID) =>
    instructions.createHold({
      sender: sender.publicKey,
      recipient,
      mint,
      tokenProgram,
      nonce: n,
      amount: AMOUNT,
      windowSecs,
      tier: Tier.SUSPICIOUS,
      evidenceHash: HASH,
    });

  // 1. Token hold, attacks against it, then undo.
  const n1 = next();
  await happy('H1', 'create_hold: 25 test tokens held for 10 minutes', [create(n1, 600)], [sender]);
  const h1 = await hold(holdPda(sender.publicKey, n1));
  await attack(
    'A1',
    'A stranger tries to undo someone else’s hold',
    'Unauthorized',
    [instructions.reclaim({ authority: attacker.publicKey, hold: h1 })],
    [attacker],
  );
  const redirected = instructions.reclaim({ authority: sender.publicKey, hold: h1 });
  redirected.keys[5] = { pubkey: attackerToken, isSigner: false, isWritable: true };
  await attack(
    'A2',
    'The sender’s undo is pointed at the attacker’s token account',
    'refused by the token-owner constraint',
    [redirected],
    [attacker, sender],
  );
  await attack(
    'A3',
    'A stranger tries to release the hold before the window ends',
    'WindowNotOver',
    [instructions.release({ caller: attacker.publicKey, hold: h1 })],
    [attacker],
  );
  await attack(
    'A4',
    'The relayer tries an early release of a wallet hold',
    'Unauthorized',
    [instructions.release({ caller: relayer.publicKey, hold: h1, early: true })],
    [relayer],
  );
  await attack(
    'A5',
    'The oracle tries to shorten the window by one second',
    'WindowCannotShrink',
    [
      instructions.extendWindow({
        riskOracle: oracle.publicKey,
        hold: h1.address,
        newReleaseAt: h1.releaseAt - 1,
        tier: Tier.FLAGGED,
        evidenceHash: HASH,
      }),
    ],
    [oracle],
  );
  await attack(
    'A6',
    'A stranger signs as the risk oracle',
    'Unauthorized',
    [
      instructions.extendWindow({
        riskOracle: attacker.publicKey,
        hold: h1.address,
        newReleaseAt: h1.releaseAt + 3600,
        tier: Tier.FLAGGED,
        evidenceHash: HASH,
      }),
    ],
    [attacker],
  );
  await happy(
    'H2',
    'extend_window: the oracle lengthens the window by one hour and raises the tier',
    [
      instructions.extendWindow({
        riskOracle: oracle.publicKey,
        hold: h1.address,
        newReleaseAt: h1.releaseAt + 3600,
        tier: Tier.FLAGGED,
        evidenceHash: HASH,
      }),
    ],
    [oracle],
  );
  await attack(
    'A7',
    'A stranger closes a pending hold to take its rent',
    'HoldStillPending',
    [
      instructions.closeHold({
        caller: attacker.publicKey,
        hold: { ...h1, rentPayer: attacker.publicKey },
      }),
    ],
    [attacker],
  );
  await happy(
    'H3',
    'reclaim: the sender undoes the hold; all 25 tokens return',
    [instructions.reclaim({ authority: sender.publicKey, hold: await hold(h1.address) })],
    [sender],
  );
  await attack(
    'A8',
    'The sender tries to undo the same hold twice',
    'refused (vault closed, hold settled)',
    [instructions.reclaim({ authority: sender.publicKey, hold: h1 })],
    [sender],
  );
  await attack(
    'A9',
    'A stranger closes the settled hold but sends the rent to themselves',
    'WrongParty',
    [
      instructions.closeHold({
        caller: attacker.publicKey,
        hold: { ...h1, rentPayer: attacker.publicKey },
      }),
    ],
    [attacker],
  );
  await happy(
    'H4',
    'close_hold: anyone closes the settled hold; rent returns to the sender',
    [instructions.closeHold({ caller: attacker.publicKey, hold: h1 })],
    [attacker],
  );

  // 2. Release after the window, by a stranger.
  const n2 = next();
  await happy('H5', 'create_hold: 25 test tokens held for 15 seconds', [create(n2, 15)], [sender]);
  const h2 = await hold(holdPda(sender.publicKey, n2));
  await attack(
    'A10',
    'A crank names itself as the recipient',
    'refused (accounts derived for a different recipient do not exist)',
    [
      instructions.release({
        caller: attacker.publicKey,
        hold: { ...h2, recipient: attacker.publicKey },
      }),
    ],
    [attacker],
  );
  await sleep(18_000);
  await attack(
    'A11',
    'The sender tries to undo after the window has ended',
    'WindowOver',
    [instructions.reclaim({ authority: sender.publicKey, hold: h2 })],
    [sender],
  );
  await happy(
    'H6',
    'release: a stranger cranks the hold to the recipient after the window',
    [instructions.release({ caller: attacker.publicKey, hold: h2 })],
    [attacker],
  );
  await happy(
    'H7',
    'close_hold after release',
    [instructions.closeHold({ caller: attacker.publicKey, hold: h2 })],
    [attacker],
  );

  // 3. Early release by the sender.
  const n3 = next();
  await happy('H8', 'create_hold: 25 test tokens held for 6 hours', [create(n3, 21_600)], [sender]);
  const h3 = await hold(holdPda(sender.publicKey, n3));
  await happy(
    'H9',
    'release_early: the sender ends the window and pays the recipient now',
    [instructions.release({ caller: sender.publicKey, hold: h3, early: true })],
    [sender],
  );

  // 4. Token-2022.
  const n4 = next();
  await happy(
    'H10',
    'create_hold with a Token-2022 mint',
    [create(n4, 600, t22, TOKEN_2022_PROGRAM_ID)],
    [sender],
  );
  await happy(
    'H11',
    'reclaim a Token-2022 hold',
    [
      instructions.reclaim({
        authority: sender.publicKey,
        hold: await hold(holdPda(sender.publicKey, n4)),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      }),
    ],
    [sender],
  );

  // 5. Trust and instant transfers.
  await attack(
    'A12',
    'An instant transfer to someone the sender never trusted',
    'refused (no Trust account)',
    [
      instructions.instantTransfer({
        sender: sender.publicKey,
        recipient: friend,
        mint: usdc,
        amount: 1_000_000n,
      }),
    ],
    [sender],
  );
  await happy(
    'H12',
    'set_trust: the sender trusts a friend',
    [instructions.setTrust({ sender: sender.publicKey, recipient: friend })],
    [sender],
  );
  await happy(
    'H13',
    'instant_transfer: 1 test token paid to the trusted friend with no wait',
    [
      instructions.instantTransfer({
        sender: sender.publicKey,
        recipient: friend,
        mint: usdc,
        amount: 1_000_000n,
      }),
    ],
    [sender],
  );
  await happy(
    'H14',
    'instant_transfer_sol: 0.002 SOL paid to the trusted friend',
    [
      instructions.instantTransferSol({
        sender: sender.publicKey,
        recipient: friend,
        amount: 2_000_000n,
      }),
    ],
    [sender],
  );
  await attack(
    'A13',
    'Someone else tries to use the sender’s trust to pay instantly',
    'refused (no Trust account for this sender)',
    [
      instructions.instantTransferSol({
        sender: attacker.publicKey,
        recipient: friend,
        amount: 1_000_000n,
      }),
    ],
    [attacker],
  );
  await happy(
    'H15',
    'remove_trust',
    [instructions.removeTrust({ sender: sender.publicKey, recipient: friend })],
    [sender],
  );

  // 6. Scam flags.
  const flag = (reporter: Keypair) =>
    instructions.flagSubject({
      reporter: reporter.publicKey,
      subject,
      reason: 1,
      evidenceHash: HASH,
    });
  await happy('H16', 'flag_subject: a report against an address', [flag(sender)], [sender]);
  await attack(
    'A14',
    'The same reporter flags the same address twice',
    'refused (the flag account already exists)',
    [flag(sender)],
    [sender],
  );

  // 7. Deposit box for a wallet that can only make transfers.
  await happy(
    'H17',
    'init_deposit_box: the relayer opens a deposit box for the owner',
    [instructions.initDepositBox({ payer: relayer.publicKey, owner: owner.publicKey, mint: usdc })],
    [relayer],
  );
  const boxToken = associatedTokenAddress(depositBoxPda(owner.publicKey), usdc);
  const ownerToken = await createAssociatedTokenAccountIdempotent(
    connection,
    deployer,
    usdc,
    owner.publicKey,
  );
  await mintTo(connection, deployer, usdc, ownerToken, deployer, 60_000_000n);
  // The owner's wallet makes a plain token transfer into the box, as an embedded wallet would.
  const deposit = await transfer(connection, owner, ownerToken, boxToken, owner, 60_000_000n);
  proofs.push({
    id: 'H18',
    kind: 'happy path',
    description: 'The owner makes a plain token transfer of 60 test tokens into their deposit box',
    expected: 'executes',
    outcome: 'executed',
    error: null,
    signature: deposit,
    explorer: explorer(deposit),
  });
  const open = (signer: Keypair, n: bigint, windowSecs: number) =>
    instructions.openHoldFromDeposit({
      relayer: signer.publicKey,
      owner: owner.publicKey,
      recipient,
      mint: usdc,
      nonce: n,
      amount: AMOUNT,
      windowSecs,
      tier: Tier.SUSPICIOUS,
      evidenceHash: HASH,
    });
  await attack(
    'A15',
    'A stranger tries to open a hold from someone’s deposit box',
    'Unauthorized',
    [open(attacker, next(), 1800)],
    [attacker],
  );
  await attack(
    'A16',
    'The relayer tries a window shorter than the default',
    'WindowTooShort',
    [open(relayer, next(), 60)],
    [relayer],
  );
  const n5 = next();
  await happy(
    'H19',
    'open_hold_from_deposit: the relayer opens a 30-minute hold; the sender is the box owner',
    [open(relayer, n5, 1800)],
    [relayer],
  );
  const h5 = await hold(holdPda(owner.publicKey, n5));
  const relayerToken = await createAssociatedTokenAccountIdempotent(
    connection,
    deployer,
    usdc,
    relayer.publicKey,
  );
  const stolen = instructions.reclaim({ authority: relayer.publicKey, hold: h5 });
  stolen.keys[5] = { pubkey: relayerToken, isSigner: false, isWritable: true };
  await attack(
    'A17',
    'The relayer points the undo at its own token account',
    'refused by the token-owner constraint',
    [stolen],
    [relayer],
  );
  await happy(
    'H20',
    'reclaim by the relayer: the refund lands in the owner’s own wallet',
    [instructions.reclaim({ authority: relayer.publicKey, hold: h5 })],
    [relayer],
  );
  await attack(
    'A18',
    'A stranger tries to withdraw from the deposit box',
    'Unauthorized',
    [
      instructions.withdrawDeposit({
        authority: attacker.publicKey,
        owner: owner.publicKey,
        mint: usdc,
        amount: 1n,
      }),
    ],
    [attacker],
  );
  const toRelayer = instructions.withdrawDeposit({
    authority: relayer.publicKey,
    owner: owner.publicKey,
    mint: usdc,
    amount: 1n,
  });
  toRelayer.keys[5] = { pubkey: relayerToken, isSigner: false, isWritable: true };
  await attack(
    'A19',
    'The relayer withdraws box funds to itself',
    'refused by the token-owner constraint',
    [toRelayer],
    [relayer],
  );
  await happy(
    'H21',
    'withdraw_deposit: the relayer returns the rest of the box to the owner',
    [
      instructions.withdrawDeposit({
        authority: relayer.publicKey,
        owner: owner.publicKey,
        mint: usdc,
        amount: 35_000_000n,
      }),
    ],
    [relayer],
  );
  await happy(
    'H22',
    'close_hold for the deposit-box hold; rent returns to the relayer',
    [instructions.closeHold({ caller: relayer.publicKey, hold: h5 })],
    [relayer],
  );

  // 8. Holds whose window the risk oracle signed, checked on-chain.
  const signedBy = (signer: Keypair, amount: bigint, windowSecs: number, expiresAt: number) => {
    const message = assessmentMessage({
      sender: sender.publicKey,
      recipient,
      mint: usdc,
      amount,
      windowSecs,
      tier: Tier.SUSPICIOUS,
      evidenceHash: HASH,
      expiresAt,
    });
    return attestationInstruction(
      signer.publicKey,
      ed25519.sign(message, signer.secretKey.subarray(0, 32)),
      message,
    );
  };
  const attested = (
    n: bigint,
    amount: bigint,
    windowSecs: number,
    signedWindow: number,
    expiresAt: number,
  ) =>
    instructions.createHoldAttested({
      sender: sender.publicKey,
      recipient,
      mint: usdc,
      nonce: n,
      amount,
      windowSecs,
      attestedWindowSecs: signedWindow,
      tier: Tier.SUSPICIOUS,
      evidenceHash: HASH,
      expiresAt,
    });
  const soon = Math.floor(Date.now() / 1000) + 600;
  await attack(
    'A20',
    'An assessment signed by someone other than the risk oracle',
    'WrongAttester',
    [signedBy(attacker, AMOUNT, 60, soon), attested(next(), AMOUNT, 60, 60, soon)],
    [attacker, sender],
  );
  await attack(
    'A21',
    'The amount is changed after the oracle signed the assessment',
    'AttestationMismatch',
    [signedBy(oracle, AMOUNT, 21_600, soon), attested(next(), AMOUNT + 1n, 21_600, 21_600, soon)],
    [sender],
  );
  await attack(
    'A22',
    'An attested hold sent without the oracle’s signature',
    'MissingAttestation',
    [attested(next(), AMOUNT, 21_600, 21_600, soon)],
    [sender],
  );
  const past = Math.floor(Date.now() / 1000) - 60;
  await attack(
    'A23',
    'An assessment used after it expired',
    'AttestationExpired',
    [signedBy(oracle, AMOUNT, 21_600, past), attested(next(), AMOUNT, 21_600, 21_600, past)],
    [sender],
  );
  await attack(
    'A24',
    'The sender asks for a shorter window than the oracle signed',
    'WindowTooShort',
    [signedBy(oracle, AMOUNT, 21_600, soon), attested(next(), AMOUNT, 1_800, 21_600, soon)],
    [sender],
  );
  const n6 = next();
  await happy(
    'H23',
    'create_hold_attested: a 6-hour hold whose window, tier and evidence hash the risk oracle signed',
    [signedBy(oracle, AMOUNT, 21_600, soon), attested(n6, AMOUNT, 21_600, 21_600, soon)],
    [sender],
  );
  await happy(
    'H24',
    'reclaim the attested hold',
    [
      instructions.reclaim({
        authority: sender.publicKey,
        hold: await hold(holdPda(sender.publicKey, n6)),
      }),
    ],
    [sender],
  );

  // Balances the run must end with.
  const finalSender = (await getAccount(connection, senderToken)).amount;
  const finalOwner = (await getAccount(connection, ownerToken)).amount;
  const finalBox = (await getAccount(connection, boxToken)).amount;
  const recipientToken = associatedTokenAddress(recipient, usdc);
  const finalRecipient = (await getAccount(connection, recipientToken)).amount;

  // Return what is left to the deployer.
  for (const key of [sender, attacker, owner]) {
    const lamports = await connection.getBalance(key.publicKey);
    if (lamports > 10_000) {
      await send(
        [
          SystemProgram.transfer({
            fromPubkey: key.publicKey,
            toPubkey: deployer.publicKey,
            lamports: lamports - 5_000,
          }),
        ],
        [key],
      );
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    cluster: 'devnet',
    program: PROGRAM_ID.toBase58(),
    test_mints: { spl: usdc.toBase58(), spl_2022: t22.toBase58() },
    parties: {
      sender: sender.publicKey.toBase58(),
      recipient: recipient.toBase58(),
      attacker: attacker.publicKey.toBase58(),
      deposit_box_owner: owner.publicKey.toBase58(),
      oracle: oracle.publicKey.toBase58(),
      relayer: relayer.publicKey.toBase58(),
    },
    balances_after: {
      sender_spl: finalSender.toString(),
      recipient_spl: finalRecipient.toString(),
      deposit_box_owner_spl: finalOwner.toString(),
      deposit_box_spl: finalBox.toString(),
    },
    counts: {
      happy_paths: proofs.filter((p) => p.kind === 'happy path').length,
      attacks_refused: proofs.filter((p) => p.kind === 'attack').length,
    },
    proofs,
  };
  mkdirSync('proofs', { recursive: true });
  writeFileSync('proofs/devnet.json', `${JSON.stringify(report, null, 2)}\n`);

  const rows = proofs.map(
    (p) =>
      `| ${p.id} | ${p.description} | ${p.kind === 'attack' ? `refused: \`${p.error}\`` : 'executed'} | [${p.signature.slice(0, 8)}…](${p.explorer}) |`,
  );
  writeFileSync(
    'proofs/DEVNET.md',
    [
      '# Devnet proofs',
      '',
      `Generated by \`scripts/prove-devnet.ts\` on ${report.generated_at.slice(0, 10)} against program \`${report.program}\`.`,
      `${report.counts.happy_paths} instructions executed and ${report.counts.attacks_refused} attacks refused on-chain. Every row links to its transaction; refused attacks are failed transactions whose logs show the program error.`,
      '',
      'Test tokens were minted by the script (classic SPL and Token-2022, 6 decimals).',
      '',
      `Balances after the run: sender ${Number(finalSender) / 1e6}, recipient ${Number(finalRecipient) / 1e6}, deposit-box owner ${Number(finalOwner) / 1e6}, deposit box ${Number(finalBox) / 1e6} test tokens.`,
      '',
      '| # | What | Result | Transaction |',
      '| --- | --- | --- | --- |',
      ...rows,
      '',
    ].join('\n'),
  );
  console.log(`\n${report.counts.happy_paths} executed, ${report.counts.attacks_refused} refused`);
}

main().catch((error) => {
  console.error('FAILED', error instanceof Error ? error.message : error);
  process.exit(1);
});
