/**
 * One builder per program instruction. Each returns a plain
 * `TransactionInstruction`, so it works with wallet adapters, Mobile Wallet
 * Adapter, server keypairs and Solana Actions alike.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

import type { Hold } from './accounts';
import { camel, encodeType, type IdlType } from './codec';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BPF_LOADER_UPGRADEABLE_ID,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from './constants';
import idl from './idl/holdback.json';
import {
  associatedTokenAddress,
  configPda,
  depositBoxPda,
  flagPda,
  holdPda,
  statsPda,
  trustPda,
  vaultAddress,
} from './pdas';

interface IdlInstruction {
  name: string;
  discriminator: number[];
  accounts: { name: string; writable?: boolean; signer?: boolean }[];
  args: { name: string; type: IdlType }[];
}

const instructions = new Map<string, IdlInstruction>(
  (idl.instructions as unknown as IdlInstruction[]).map((ix) => [ix.name, ix]),
);

/**
 * Encodes any instruction from the IDL. Account and argument names are the
 * camelCase form of the IDL names; a missing one throws.
 */
export function buildInstruction(
  name: string,
  accounts: Record<string, PublicKey>,
  args: Record<string, unknown> = {},
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  const spec = instructions.get(name);
  if (!spec) throw new Error(`Unknown instruction: ${name}`);

  const data: number[] = [...spec.discriminator];
  for (const arg of spec.args) {
    const key = camel(arg.name);
    if (!(key in args)) throw new Error(`${name}: missing argument ${key}`);
    encodeType(arg.type, args[key], data, key);
  }

  const keys = spec.accounts.map((account) => {
    const key = camel(account.name);
    const pubkey = accounts[key];
    if (!pubkey) throw new Error(`${name}: missing account ${key}`);
    return { pubkey, isSigner: !!account.signer, isWritable: !!account.writable };
  });

  return new TransactionInstruction({ programId, keys, data: Buffer.from(data) });
}

/** The parts of a hold the settle instructions need. A decoded `Hold` fits. */
export type HoldRef = Pick<Hold, 'address' | 'sender' | 'recipient' | 'mint' | 'rentPayer'>;

interface WithProgram {
  programId?: PublicKey;
}

interface TokenParams extends WithProgram {
  mint: PublicKey;
  /** Defaults to the classic SPL Token program. Pass Token-2022 for its mints. */
  tokenProgram?: PublicKey;
}

interface NewHoldArgs {
  nonce: bigint;
  amount: bigint;
  windowSecs: number;
  tier: number;
  evidenceHash: Uint8Array;
}

function holdArgs(params: NewHoldArgs) {
  return {
    nonce: params.nonce,
    amount: params.amount,
    windowSecs: params.windowSecs,
    tier: params.tier,
    evidenceHash: params.evidenceHash,
  };
}

export function initializeConfig(
  params: WithProgram & {
    admin: PublicKey;
    relayer: PublicKey;
    riskOracle: PublicKey;
    minWindowSecs: number;
    defaultWindowSecs: number;
    maxWindowSecs: number;
  },
): TransactionInstruction {
  const programId = params.programId ?? PROGRAM_ID;
  const [programData] = PublicKey.findProgramAddressSync(
    [programId.toBytes()],
    BPF_LOADER_UPGRADEABLE_ID,
  );
  return buildInstruction(
    'initialize_config',
    {
      admin: params.admin,
      config: configPda(programId),
      program: programId,
      programData,
      systemProgram: SystemProgram.programId,
    },
    {
      relayer: params.relayer,
      riskOracle: params.riskOracle,
      minWindowSecs: params.minWindowSecs,
      defaultWindowSecs: params.defaultWindowSecs,
      maxWindowSecs: params.maxWindowSecs,
    },
    programId,
  );
}

export interface UpdateConfigArgs {
  admin?: PublicKey | null;
  relayer?: PublicKey | null;
  riskOracle?: PublicKey | null;
  minWindowSecs?: number | null;
  defaultWindowSecs?: number | null;
  maxWindowSecs?: number | null;
  paused?: boolean | null;
}

export function updateConfig(
  params: WithProgram & { admin: PublicKey; args: UpdateConfigArgs },
): TransactionInstruction {
  return buildInstruction(
    'update_config',
    { admin: params.admin, config: configPda(params.programId) },
    {
      args: {
        admin: params.args.admin ?? null,
        relayer: params.args.relayer ?? null,
        riskOracle: params.args.riskOracle ?? null,
        minWindowSecs: params.args.minWindowSecs ?? null,
        defaultWindowSecs: params.args.defaultWindowSecs ?? null,
        maxWindowSecs: params.args.maxWindowSecs ?? null,
        paused: params.args.paused ?? null,
      },
    },
    params.programId,
  );
}

export function createHold(
  params: TokenParams & NewHoldArgs & { sender: PublicKey; recipient: PublicKey },
): TransactionInstruction {
  const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ID;
  const hold = holdPda(params.sender, params.nonce, params.programId);
  return buildInstruction(
    'create_hold',
    {
      sender: params.sender,
      recipient: params.recipient,
      config: configPda(params.programId),
      mint: params.mint,
      senderToken: associatedTokenAddress(params.sender, params.mint, tokenProgram),
      hold,
      vault: vaultAddress(hold, params.mint, tokenProgram),
      recipientStats: statsPda(params.recipient, params.programId),
      tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    },
    holdArgs(params),
    params.programId,
  );
}

export function createHoldSol(
  params: WithProgram & NewHoldArgs & { sender: PublicKey; recipient: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    'create_hold_sol',
    {
      sender: params.sender,
      recipient: params.recipient,
      config: configPda(params.programId),
      hold: holdPda(params.sender, params.nonce, params.programId),
      recipientStats: statsPda(params.recipient, params.programId),
      systemProgram: SystemProgram.programId,
    },
    holdArgs(params),
    params.programId,
  );
}

/** Zero-window payment to a recipient the sender has marked as trusted. */
export function instantTransfer(
  params: TokenParams & { sender: PublicKey; recipient: PublicKey; amount: bigint },
): TransactionInstruction {
  const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ID;
  return buildInstruction(
    'instant_transfer',
    {
      sender: params.sender,
      recipient: params.recipient,
      config: configPda(params.programId),
      trust: trustPda(params.sender, params.recipient, params.programId),
      mint: params.mint,
      senderToken: associatedTokenAddress(params.sender, params.mint, tokenProgram),
      recipientToken: associatedTokenAddress(params.recipient, params.mint, tokenProgram),
      recipientStats: statsPda(params.recipient, params.programId),
      tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    },
    { amount: params.amount },
    params.programId,
  );
}

export function instantTransferSol(
  params: WithProgram & { sender: PublicKey; recipient: PublicKey; amount: bigint },
): TransactionInstruction {
  return buildInstruction(
    'instant_transfer_sol',
    {
      sender: params.sender,
      recipient: params.recipient,
      config: configPda(params.programId),
      trust: trustPda(params.sender, params.recipient, params.programId),
      recipientStats: statsPda(params.recipient, params.programId),
      systemProgram: SystemProgram.programId,
    },
    { amount: params.amount },
    params.programId,
  );
}

export function initDepositBox(
  params: TokenParams & { payer: PublicKey; owner: PublicKey },
): TransactionInstruction {
  const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ID;
  const depositBox = depositBoxPda(params.owner, params.programId);
  return buildInstruction(
    'init_deposit_box',
    {
      payer: params.payer,
      owner: params.owner,
      depositBox,
      mint: params.mint,
      boxToken: associatedTokenAddress(depositBox, params.mint, tokenProgram),
      tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    },
    {},
    params.programId,
  );
}

/** Relayer-only. The hold's sender is the box owner. */
export function openHoldFromDeposit(
  params: TokenParams &
    NewHoldArgs & { relayer: PublicKey; owner: PublicKey; recipient: PublicKey },
): TransactionInstruction {
  const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ID;
  const depositBox = depositBoxPda(params.owner, params.programId);
  const hold = holdPda(params.owner, params.nonce, params.programId);
  return buildInstruction(
    'open_hold_from_deposit',
    {
      relayer: params.relayer,
      config: configPda(params.programId),
      depositBox,
      recipient: params.recipient,
      mint: params.mint,
      boxToken: associatedTokenAddress(depositBox, params.mint, tokenProgram),
      hold,
      vault: vaultAddress(hold, params.mint, tokenProgram),
      recipientStats: statsPda(params.recipient, params.programId),
      tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    },
    holdArgs(params),
    params.programId,
  );
}

/** Returns box funds to the owner. `authority` is the owner or the relayer. */
export function withdrawDeposit(
  params: TokenParams & { authority: PublicKey; owner: PublicKey; amount: bigint },
): TransactionInstruction {
  const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ID;
  const depositBox = depositBoxPda(params.owner, params.programId);
  return buildInstruction(
    'withdraw_deposit',
    {
      authority: params.authority,
      config: configPda(params.programId),
      depositBox,
      mint: params.mint,
      boxToken: associatedTokenAddress(depositBox, params.mint, tokenProgram),
      ownerToken: associatedTokenAddress(params.owner, params.mint, tokenProgram),
      tokenProgram,
    },
    { amount: params.amount },
    params.programId,
  );
}

/** Oracle-only. `newReleaseAt` is unix seconds and can only move later. */
export function extendWindow(
  params: WithProgram & {
    riskOracle: PublicKey;
    hold: PublicKey;
    newReleaseAt: number | bigint;
    tier: number;
    evidenceHash: Uint8Array;
  },
): TransactionInstruction {
  return buildInstruction(
    'extend_window',
    { riskOracle: params.riskOracle, config: configPda(params.programId), hold: params.hold },
    {
      newReleaseAt: BigInt(params.newReleaseAt),
      tier: params.tier,
      evidenceHash: params.evidenceHash,
    },
    params.programId,
  );
}

/**
 * Undo. `authority` is the sender (or the relayer for a deposit-box hold).
 * Picks the SOL or token instruction from the hold itself.
 */
export function reclaim(
  params: WithProgram & { authority: PublicKey; hold: HoldRef; tokenProgram?: PublicKey },
): TransactionInstruction {
  const { hold, programId } = params;
  const common = {
    authority: params.authority,
    config: configPda(programId),
    hold: hold.address,
    recipientStats: statsPda(hold.recipient, programId),
  };
  if (hold.mint.equals(PublicKey.default)) {
    return buildInstruction('reclaim_sol', { ...common, sender: hold.sender }, {}, programId);
  }
  const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ID;
  return buildInstruction(
    'reclaim',
    {
      ...common,
      mint: hold.mint,
      vault: vaultAddress(hold.address, hold.mint, tokenProgram),
      senderToken: associatedTokenAddress(hold.sender, hold.mint, tokenProgram),
      rentPayer: hold.rentPayer,
      tokenProgram,
    },
    {},
    programId,
  );
}

/**
 * Pays the recipient. With `early: false` anyone may call it once the window
 * is over; with `early: true` the caller must be the sender.
 */
export function release(
  params: WithProgram & {
    caller: PublicKey;
    hold: HoldRef;
    early?: boolean;
    tokenProgram?: PublicKey;
  },
): TransactionInstruction {
  const { hold, programId } = params;
  const early = params.early ?? false;
  if (hold.mint.equals(PublicKey.default)) {
    return buildInstruction(
      early ? 'release_early_sol' : 'release_sol',
      {
        caller: params.caller,
        hold: hold.address,
        recipient: hold.recipient,
        recipientStats: statsPda(hold.recipient, programId),
      },
      {},
      programId,
    );
  }
  const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ID;
  return buildInstruction(
    early ? 'release_early' : 'release',
    {
      caller: params.caller,
      hold: hold.address,
      mint: hold.mint,
      vault: vaultAddress(hold.address, hold.mint, tokenProgram),
      recipient: hold.recipient,
      recipientToken: associatedTokenAddress(hold.recipient, hold.mint, tokenProgram),
      rentPayer: hold.rentPayer,
      recipientStats: statsPda(hold.recipient, programId),
      tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    },
    {},
    programId,
  );
}

export function setTrust(
  params: WithProgram & { sender: PublicKey; recipient: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    'set_trust',
    {
      sender: params.sender,
      recipient: params.recipient,
      trust: trustPda(params.sender, params.recipient, params.programId),
      systemProgram: SystemProgram.programId,
    },
    {},
    params.programId,
  );
}

export function removeTrust(
  params: WithProgram & { sender: PublicKey; recipient: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    'remove_trust',
    {
      sender: params.sender,
      recipient: params.recipient,
      trust: trustPda(params.sender, params.recipient, params.programId),
    },
    {},
    params.programId,
  );
}

export function flagSubject(
  params: WithProgram & {
    reporter: PublicKey;
    subject: PublicKey;
    reason: number;
    evidenceHash: Uint8Array;
  },
): TransactionInstruction {
  return buildInstruction(
    'flag_subject',
    {
      reporter: params.reporter,
      subject: params.subject,
      flag: flagPda(params.reporter, params.subject, params.programId),
      subjectStats: statsPda(params.subject, params.programId),
      systemProgram: SystemProgram.programId,
    },
    { reason: params.reason, evidenceHash: params.evidenceHash },
    params.programId,
  );
}

/** Closes a settled hold. Anyone may call it; the rent goes to the rent payer. */
export function closeHold(
  params: WithProgram & { caller: PublicKey; hold: Pick<Hold, 'address' | 'rentPayer'> },
): TransactionInstruction {
  return buildInstruction(
    'close_hold',
    { caller: params.caller, hold: params.hold.address, rentPayer: params.hold.rentPayer },
    {},
    params.programId,
  );
}
