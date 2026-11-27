/**
 * Server loader for the public receipt at `/h/[holdPda]`.
 *
 * Two sources are merged. The chain is the source of truth for everything
 * about the money: parties, amount, status, release time and the evidence
 * hash. The agent supplies what cannot live on-chain: the evidence document,
 * the spoken explanation, the voice note and the transaction signatures.
 *
 * Either source can be down or have nothing, and the receipt says which:
 * a hold that was closed on-chain still renders from the agent's mirror, and
 * a hold the agent has never seen still renders from the chain, without
 * evidence.
 */
import 'server-only';

import {
  GuardianError,
  PROGRAM_ID,
  decodeHold,
  type EvidenceDocument,
  type GuardianClient,
  type Hold,
  type HoldReceipt,
  type HoldRecord,
  type Lang,
} from '@holdback/sdk';
import { PublicKey, type Connection } from '@solana/web3.js';

import { serverGuardian } from '../guardian.server';
import { holdToRecord } from '../holds';
import { serverConnection } from '../solana.server';

/** `ok`: answered with data. `missing`: answered, has nothing. `unavailable`: did not answer. */
export type SourceState = 'ok' | 'missing' | 'unavailable';

export interface Receipt {
  pda: string;
  hold: HoldRecord;
  /**
   * Where the hold's fields came from. `mirror` means the account is not
   * readable on-chain right now (closed after settlement, or the RPC is
   * down), so the data and the evidence hash are the agent's copy.
   */
  holdSource: 'chain' | 'mirror';
  sources: { chain: SourceState; agent: SourceState };
  document: EvidenceDocument | null;
  spoken: Partial<Record<Lang, string>>;
  voiceNoteUrl: string | null;
  loadedAt: string;
}

export type ReceiptResult =
  | { kind: 'found'; receipt: Receipt }
  /** The address is not a valid public key. */
  | { kind: 'invalid' }
  /** No hold is known at this address. `sources` tells a firm "no" from an outage. */
  | { kind: 'not_found'; sources: { chain: SourceState; agent: SourceState } };

export interface ReceiptSources {
  connection: Pick<Connection, 'getAccountInfo'>;
  guardian: Pick<GuardianClient, 'receipt' | 'evidence'> | null;
}

type Outcome<T> = { state: 'ok'; value: T } | { state: 'missing' | 'unavailable' };

/**
 * The SDK's `fetchHold`, taken in its two steps so an RPC outage and an
 * address that simply is not a hold give different answers.
 */
async function readChain(sources: ReceiptSources, address: PublicKey): Promise<Outcome<Hold>> {
  let info: Awaited<ReturnType<Connection['getAccountInfo']>>;
  try {
    info = await sources.connection.getAccountInfo(address);
  } catch {
    return { state: 'unavailable' };
  }
  if (!info || !info.owner.equals(PROGRAM_ID)) return { state: 'missing' };
  try {
    return { state: 'ok', value: decodeHold(address, info.data) };
  } catch {
    // Owned by the program but another account type (a config, a trust record, ...).
    return { state: 'missing' };
  }
}

async function readAgent(sources: ReceiptSources, pda: string): Promise<Outcome<HoldReceipt>> {
  if (!sources.guardian) return { state: 'unavailable' };
  try {
    return { state: 'ok', value: await sources.guardian.receipt(pda) };
  } catch (failure) {
    const notFound = failure instanceof GuardianError && failure.status === 404;
    return { state: notFound ? 'missing' : 'unavailable' };
  }
}

/** The evidence store is addressed by hash, so a document can exist without a mirrored hold. */
async function documentByHash(
  sources: ReceiptSources,
  hash: string,
): Promise<EvidenceDocument | null> {
  if (!sources.guardian || /^0+$/.test(hash)) return null;
  try {
    return await sources.guardian.evidence(hash);
  } catch {
    return null;
  }
}

export async function loadReceipt(
  pda: string,
  sources: ReceiptSources = { connection: serverConnection(), guardian: serverGuardian() },
): Promise<ReceiptResult> {
  let address: PublicKey;
  try {
    address = new PublicKey(pda);
  } catch {
    return { kind: 'invalid' };
  }

  const [chain, agent] = await Promise.all([readChain(sources, address), readAgent(sources, pda)]);
  const states = { chain: chain.state, agent: agent.state };
  const mirrored = agent.state === 'ok' ? agent.value : null;

  if (chain.state !== 'ok' && !mirrored) return { kind: 'not_found', sources: states };

  const hold: HoldRecord =
    chain.state === 'ok'
      ? {
          ...holdToRecord(chain.value),
          createSignature: mirrored?.hold.createSignature ?? null,
          settleSignature: mirrored?.hold.settleSignature ?? null,
        }
      : // Narrowed above: without the chain there is always a mirrored record.
        (mirrored as HoldReceipt).hold;

  // Only a document stored under the hold's own hash is worth showing; the
  // browser re-checks it, but a document for another hash would be noise.
  const sameHash = mirrored?.hold.evidenceHash === hold.evidenceHash;
  const document =
    (sameHash ? mirrored?.document : null) ?? (await documentByHash(sources, hold.evidenceHash));

  return {
    kind: 'found',
    receipt: {
      pda: address.toBase58(),
      hold,
      holdSource: chain.state === 'ok' ? 'chain' : 'mirror',
      sources: states,
      document,
      spoken: sameHash ? (mirrored?.spoken ?? {}) : {},
      voiceNoteUrl: sameHash ? (mirrored?.voiceNoteUrl ?? null) : null,
      loadedAt: new Date().toISOString(),
    },
  };
}
