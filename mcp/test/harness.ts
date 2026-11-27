/**
 * Test doubles for the two things the server talks to: a Solana RPC node and
 * the Guardian. They live here, in the test tree only; the server itself
 * never contains a mock.
 */
import {
  GuardianError,
  HoldOrigin,
  HoldStatus,
  IDL,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  Tier,
  accountDiscriminator,
  hashEvidence,
  toHex,
  type AssessRequest,
  type AssessResponse,
  type EvidenceDocument,
  type HoldReceipt,
  type HoldRecord,
} from '@holdback/sdk';
import { encodeType } from '@holdback/sdk/dist/codec';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  Keypair,
  PublicKey,
  VersionedTransaction,
  type AccountInfo,
  type Connection,
} from '@solana/web3.js';
import bs58 from 'bs58';

import { createServer, type Guardian, type ServerDeps } from '../src/server';

export const NOW = 1_800_000_000;
export const BLOCKHASH = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
export const LAST_VALID_BLOCK_HEIGHT = 123_456;

type StoredAccount = Pick<AccountInfo<Buffer>, 'owner' | 'data' | 'lamports'>;

interface MemcmpFilter {
  memcmp: { offset: number; bytes: string };
}

/** An in-memory stand-in for `Connection`, covering the calls the server makes. */
export class FakeChain {
  readonly accounts = new Map<string, StoredAccount>();
  readonly sent: VersionedTransaction[] = [];
  blockhashRequests = 0;
  /** Set to make account scans fail, as on RPC nodes that disable them. */
  scansFail = false;
  /** Set to make the node reject the next send, as preflight does for a program error. */
  sendFailure: Error | null = null;
  /** Runs when a transaction is "confirmed", to apply its effect to `accounts`. */
  onSend: (transaction: VersionedTransaction) => void = () => {};

  set(address: PublicKey, owner: PublicKey, data: Uint8Array): void {
    this.accounts.set(address.toBase58(), { owner, data: Buffer.from(data), lamports: 1_000_000 });
  }

  asConnection(): Connection {
    const fake = {
      getAccountInfo: async (address: PublicKey) => {
        const account = this.accounts.get(address.toBase58());
        return account ? { ...account, executable: false, rentEpoch: 0 } : null;
      },
      getLatestBlockhash: async () => {
        this.blockhashRequests += 1;
        return { blockhash: BLOCKHASH, lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT };
      },
      getRecentPrioritizationFees: async () => [{ slot: 1, prioritizationFee: 5_000 }],
      getProgramAccounts: async (programId: PublicKey, config: { filters: MemcmpFilter[] }) => {
        if (this.scansFail) throw new Error('getProgramAccounts is not available');
        return [...this.accounts.entries()]
          .filter(([, account]) => account.owner.equals(programId))
          .filter(([, account]) =>
            config.filters.every(({ memcmp }) => {
              const want = bs58.decode(memcmp.bytes);
              const have = account.data.subarray(memcmp.offset, memcmp.offset + want.length);
              return Buffer.from(want).equals(have);
            }),
          )
          .map(([address, account]) => ({
            pubkey: new PublicKey(address),
            account: { ...account, executable: false, rentEpoch: 0 },
          }));
      },
      sendTransaction: async (transaction: VersionedTransaction) => {
        if (this.sendFailure) throw this.sendFailure;
        this.sent.push(transaction);
        this.onSend(transaction);
        return bs58.encode(transaction.signatures[0]!);
      },
      confirmTransaction: async () => ({ context: { slot: 1 }, value: { err: null } }),
    };
    return fake as unknown as Connection;
  }

  addMint(mint: PublicKey, decimals: number): void {
    const data = new Uint8Array(82);
    data[44] = decimals;
    this.set(mint, TOKEN_PROGRAM_ID, data);
  }

  addHold(address: PublicKey, fields: HoldFields): void {
    this.set(address, PROGRAM_ID, encodeAccount('Hold', { ...fields }));
  }

  addTrust(address: PublicKey, sender: PublicKey, recipient: PublicKey): void {
    const fields = { sender, recipient, createdAt: BigInt(NOW - 60), bump: 255 };
    this.set(address, PROGRAM_ID, encodeAccount('Trust', fields));
  }
}

export interface HoldFields {
  sender: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  amount: bigint;
  createdAt: bigint;
  releaseAt: bigint;
  tier: number;
  evidenceHash: Uint8Array;
  origin: number;
  status: number;
  rentPayer: PublicKey;
  nonce: bigint;
  bump: number;
}

function encodeAccount(name: 'Hold' | 'Trust', value: Record<string, unknown>): Uint8Array {
  const out: number[] = [...accountDiscriminator(name)];
  encodeType({ defined: { name } }, value, out);
  return Uint8Array.from(out);
}

export function holdFields(
  overrides: Partial<HoldFields> & Pick<HoldFields, 'sender'>,
): HoldFields {
  return {
    recipient: Keypair.generate().publicKey,
    mint: PublicKey.default,
    amount: 2_000_000_000n,
    createdAt: BigInt(NOW - 600),
    releaseAt: BigInt(NOW + 1_200),
    tier: Tier.UNKNOWN,
    evidenceHash: new Uint8Array(32).fill(7),
    origin: HoldOrigin.WALLET,
    status: HoldStatus.PENDING,
    rentPayer: overrides.sender,
    nonce: 42n,
    bump: 254,
    ...overrides,
  };
}

export function evidenceDocument(overrides: Partial<EvidenceDocument> = {}): EvidenceDocument {
  return {
    policyVersion: 'test-1',
    assessedAt: new Date(NOW * 1000).toISOString(),
    sender: Keypair.generate().publicKey.toBase58(),
    recipient: Keypair.generate().publicKey.toBase58(),
    mint: 'SOL',
    amount: '2000000000',
    score: 12,
    tier: 'UNKNOWN',
    windowSecs: 1_800,
    findings: [],
    evidence: [],
    unavailable: [],
    ...overrides,
  };
}

/** An assessment as the Guardian would return it for `tier`. */
export function assessment(
  tier: keyof typeof Tier,
  windowSecs: number,
  overrides: Partial<AssessResponse> = {},
): AssessResponse {
  const document = evidenceDocument({ tier, windowSecs });
  return {
    tier,
    tierIndex: Tier[tier],
    windowSecs,
    score: 12,
    findings: [],
    evidence: [],
    spoken: { lang: 'en', text: 'Nothing is known about this recipient yet.' },
    evidenceHash: toHex(hashEvidence(document)),
    document,
    unavailable: [],
    requiresConfirmation: tier === 'SANCTIONED',
    latencyMs: 40,
    ...overrides,
  };
}

/** A scripted Guardian that records what it was asked. */
export class FakeGuardian implements Guardian {
  readonly assessRequests: AssessRequest[] = [];
  readonly documents = new Map<string, EvidenceDocument>();
  readonly receipts = new Map<string, HoldRecord>();
  records: HoldRecord[] = [];
  next: AssessResponse = assessment('UNKNOWN', 1_800);

  async assess(request: AssessRequest): Promise<AssessResponse> {
    this.assessRequests.push(request);
    return this.next;
  }

  async evidence(hash: string): Promise<EvidenceDocument> {
    const document = this.documents.get(hash);
    if (!document) throw new GuardianError(404, 'not_found', 'No such evidence');
    return document;
  }

  async receipt(pda: string): Promise<HoldReceipt> {
    const hold = this.receipts.get(pda);
    if (!hold) throw new GuardianError(404, 'not_found', 'No such hold');
    return { hold, document: null, spoken: {}, voiceNoteUrl: null };
  }

  async holds(): Promise<{ holds: HoldRecord[] }> {
    return { holds: this.records };
  }
}

export interface ToolOutcome {
  isError: boolean;
  /** `structuredContent` on success; the `error` body on failure. */
  data: Record<string, any>;
  text: string;
}

export interface Session {
  client: Client;
  chain: FakeChain;
  guardian: FakeGuardian;
  call(name: string, args?: Record<string, unknown>): Promise<ToolOutcome>;
}

/** Starts a server over an in-memory transport pair and connects a real MCP client to it. */
export async function startSession(
  options: Partial<Pick<ServerDeps, 'signer' | 'maxAmount'>> & { guardian?: boolean } = {},
): Promise<Session> {
  const chain = new FakeChain();
  const guardian = new FakeGuardian();
  const server = createServer({
    connection: chain.asConnection(),
    guardian: options.guardian === false ? null : guardian,
    signer: options.signer ?? null,
    maxAmount: options.maxAmount ?? null,
    now: () => NOW,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'holdback-mcp-tests', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  // Listing first makes the client validate every structured result against
  // the tool's published output schema, as a real client would.
  await client.listTools();

  return {
    client,
    chain,
    guardian,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const first = (result.content as { type: string; text?: string }[])[0];
      const text = first?.text ?? '';
      if (result.isError) {
        let data: Record<string, any> = {};
        try {
          data = (JSON.parse(text) as { error: Record<string, any> }).error;
        } catch {
          // Protocol-level refusals (schema validation) are plain text.
        }
        return { isError: true, data, text };
      }
      return { isError: false, data: result.structuredContent as Record<string, any>, text };
    },
  };
}

export interface DecodedInstruction {
  name: string;
  data: Uint8Array;
  accounts: PublicKey[];
}

/** The HOLDBACK instruction inside a transaction, identified through the IDL. */
export function programInstruction(transaction: VersionedTransaction): DecodedInstruction {
  const keys = transaction.message.staticAccountKeys;
  const compiled = transaction.message.compiledInstructions.find((instruction) =>
    keys[instruction.programIdIndex]!.equals(PROGRAM_ID),
  );
  if (!compiled) throw new Error('The transaction has no HOLDBACK instruction');
  const head = [...compiled.data.subarray(0, 8)].join(',');
  const spec = IDL.instructions.find((ix) => ix.discriminator.join(',') === head);
  if (!spec) throw new Error('Unknown HOLDBACK instruction');
  return {
    name: spec.name,
    data: compiled.data.subarray(8),
    accounts: compiled.accountKeyIndexes.map((index) => keys[index]!),
  };
}

export function decodeTransaction(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
}

/** The arguments shared by `create_hold` and `create_hold_sol`. */
export function holdArgs(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    nonce: view.getBigUint64(0, true),
    amount: view.getBigUint64(8, true),
    windowSecs: view.getUint32(16, true),
    tier: view.getUint8(20),
    evidenceHash: toHex(data.subarray(21, 53)),
  };
}

export function isUnsigned(transaction: VersionedTransaction): boolean {
  return transaction.signatures.every((signature) => signature.every((byte) => byte === 0));
}
