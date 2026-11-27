import {
  GuardianError,
  PROGRAM_ID,
  Tier,
  accountDiscriminator,
  hashEvidence,
  toHex,
  type EvidenceDocument,
  type HoldReceipt,
} from '@holdback/sdk';
import { Keypair, PublicKey, type AccountInfo } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { loadReceipt, type ReceiptSources } from '@/lib/receipt/load';

import { evidenceDocument } from './helpers/guardian';

const pda = Keypair.generate().publicKey;
const sender = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;

const document: EvidenceDocument = evidenceDocument(
  {
    sender: sender.toBase58(),
    recipient: recipient.toBase58(),
    mint: null,
    amount: '500000000',
    lang: 'en',
  },
  Tier.FLAGGED,
);
const hash = hashEvidence(document);

function u64(value: bigint): number[] {
  return Array.from({ length: 8 }, (_, index) => Number((value >> BigInt(index * 8)) & 0xffn));
}

/** A `Hold` account in the program's layout: a pending SOL hold from the wallet. */
function holdAccount(status = 0): AccountInfo<Buffer> {
  const data = Uint8Array.from([
    ...accountDiscriminator('Hold'),
    ...sender.toBytes(),
    ...recipient.toBytes(),
    ...PublicKey.default.toBytes(),
    ...u64(500_000_000n),
    ...u64(1_795_000_000n),
    ...u64(1_795_086_400n),
    Tier.FLAGGED,
    ...hash,
    0,
    status,
    ...sender.toBytes(),
    ...u64(7n),
    254,
  ]);
  return { owner: PROGRAM_ID, data: Buffer.from(data), lamports: 1, executable: false };
}

const mirrored: HoldReceipt = {
  hold: {
    pda: pda.toBase58(),
    sender: sender.toBase58(),
    recipient: recipient.toBase58(),
    mint: null,
    amount: '500000000',
    tier: 'FLAGGED',
    origin: 'WALLET',
    // The mirror lags: the chain already says RELEASED in the test below.
    status: 'PENDING',
    createdAt: new Date(1_795_000_000_000).toISOString(),
    releaseAt: new Date(1_795_086_400_000).toISOString(),
    evidenceHash: toHex(hash),
    createSignature: 'createSig',
    settleSignature: null,
  },
  document,
  spoken: { en: 'This recipient has been reported.' },
  voiceNoteUrl: 'https://agent.test/v1/voice/note/abc?lang=en',
};

type Chain = 'ok' | 'missing' | 'down';
type Agent = 'ok' | 'missing' | 'down' | 'none';

function sources(chain: Chain, agent: Agent, receipt: HoldReceipt = mirrored): ReceiptSources {
  return {
    connection: {
      getAccountInfo: async () => {
        if (chain === 'down') throw new Error('RPC unreachable');
        return chain === 'ok' ? holdAccount(1) : null;
      },
    },
    guardian:
      agent === 'none'
        ? null
        : {
            receipt: async () => {
              if (agent === 'down') throw new GuardianError(503, 'unavailable', 'down');
              if (agent === 'missing') throw new GuardianError(404, 'not_found', 'no such hold');
              return receipt;
            },
            evidence: async () => {
              if (agent !== 'ok') throw new GuardianError(404, 'not_found', 'no document');
              return document;
            },
          },
  };
}

describe('loadReceipt', () => {
  it('merges both sources and lets the chain win on money fields', async () => {
    const result = await loadReceipt(pda.toBase58(), sources('ok', 'ok'));
    if (result.kind !== 'found') throw new Error(result.kind);
    const { receipt } = result;

    expect(receipt.holdSource).toBe('chain');
    expect(receipt.sources).toEqual({ chain: 'ok', agent: 'ok' });
    expect(receipt.hold.status).toBe('RELEASED');
    expect(receipt.hold.amount).toBe('500000000');
    expect(receipt.hold.mint).toBeNull();
    expect(receipt.hold.tier).toBe('FLAGGED');
    expect(receipt.hold.evidenceHash).toBe(toHex(hash));
    // Signatures are not on-chain; they come from the mirror.
    expect(receipt.hold.createSignature).toBe('createSig');
    expect(receipt.document).toEqual(document);
    expect(receipt.spoken.en).toBe('This recipient has been reported.');
    expect(receipt.voiceNoteUrl).toContain('/v1/voice/note/');
  });

  it.each(['missing', 'down', 'none'] as const)(
    'shows the on-chain hold without evidence when the agent is %s',
    async (agent) => {
      const result = await loadReceipt(pda.toBase58(), sources('ok', agent));
      if (result.kind !== 'found') throw new Error(result.kind);
      expect(result.receipt.holdSource).toBe('chain');
      expect(result.receipt.sources.agent).toBe(agent === 'missing' ? 'missing' : 'unavailable');
      expect(result.receipt.hold.status).toBe('RELEASED');
      expect(result.receipt.hold.createSignature).toBeNull();
      expect(result.receipt.document).toBeNull();
      expect(result.receipt.spoken).toEqual({});
      expect(result.receipt.voiceNoteUrl).toBeNull();
    },
  );

  it.each([
    ['missing', 'missing'],
    ['down', 'unavailable'],
  ] as const)('falls back to the mirror when the chain is %s', async (chain, state) => {
    const result = await loadReceipt(pda.toBase58(), sources(chain, 'ok'));
    if (result.kind !== 'found') throw new Error(result.kind);
    expect(result.receipt.holdSource).toBe('mirror');
    expect(result.receipt.sources).toEqual({ chain: state, agent: 'ok' });
    expect(result.receipt.hold.status).toBe('PENDING');
    expect(result.receipt.document).toEqual(document);
  });

  it('fetches the document by hash when the mirrored receipt has none', async () => {
    const result = await loadReceipt(
      pda.toBase58(),
      sources('ok', 'ok', { ...mirrored, document: null }),
    );
    if (result.kind !== 'found') throw new Error(result.kind);
    expect(result.receipt.document).toEqual(document);
  });

  it('drops evidence the agent stored under a different hash', async () => {
    const stale: HoldReceipt = {
      ...mirrored,
      hold: { ...mirrored.hold, evidenceHash: 'ab'.repeat(32) },
    };
    const withoutStore = sources('ok', 'ok', stale);
    withoutStore.guardian!.evidence = async () => {
      throw new GuardianError(404, 'not_found', 'no document');
    };
    const result = await loadReceipt(pda.toBase58(), withoutStore);
    if (result.kind !== 'found') throw new Error(result.kind);
    expect(result.receipt.hold.evidenceHash).toBe(toHex(hash));
    expect(result.receipt.document).toBeNull();
    expect(result.receipt.spoken).toEqual({});
  });

  it('tells a firm "not found" from an outage', async () => {
    expect(await loadReceipt(pda.toBase58(), sources('missing', 'missing'))).toEqual({
      kind: 'not_found',
      sources: { chain: 'missing', agent: 'missing' },
    });
    expect(await loadReceipt(pda.toBase58(), sources('down', 'down'))).toEqual({
      kind: 'not_found',
      sources: { chain: 'unavailable', agent: 'unavailable' },
    });
  });

  it('treats a program account that is not a hold as missing, not as an outage', async () => {
    const notAHold: ReceiptSources = {
      connection: {
        getAccountInfo: async () => ({
          owner: PROGRAM_ID,
          data: Buffer.from(new Uint8Array(81)),
          lamports: 1,
          executable: false,
        }),
      },
      guardian: null,
    };
    expect(await loadReceipt(pda.toBase58(), notAHold)).toEqual({
      kind: 'not_found',
      sources: { chain: 'missing', agent: 'unavailable' },
    });
  });

  it('rejects an address that is not a public key without calling anything', async () => {
    const untouched: ReceiptSources = {
      connection: {
        getAccountInfo: async () => {
          throw new Error('must not be called');
        },
      },
      guardian: null,
    };
    expect(await loadReceipt('not-a-key', untouched)).toEqual({ kind: 'invalid' });
  });
});
