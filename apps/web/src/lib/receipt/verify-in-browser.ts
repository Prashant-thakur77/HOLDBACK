/**
 * The full "verify hash" flow, run entirely by the visitor's browser.
 *
 * Nothing the server rendered is taken on trust when it can be avoided: the
 * hash is read from the hold account over RPC, the evidence document is
 * downloaded by that hash from the agent, and the sha256 is recomputed
 * locally with `verifyReceipt`.
 *
 * This module pulls in the Solana client, so the receipt page loads it only
 * when the button is pressed (see `useVerifyReceipt`).
 */
import { fetchHold, fromHex, toHex, type EvidenceDocument } from '@holdback/sdk';
import { PublicKey } from '@solana/web3.js';

import { createGuardian } from '../guardian';
import { createConnection } from '../solana';
import { verifyReceipt, type ReceiptVerification } from './verify';

export interface VerifyInput {
  pda: string;
  /** Hex hash shown on the page; used only if the chain cannot be read from the browser. */
  evidenceHash: string;
  /** Document delivered with the page; used only if the agent does not answer. */
  document: EvidenceDocument | null;
}

export interface VerifyResult extends ReceiptVerification {
  /** `chain`: the hash was read from the hold account by this browser just now. */
  hashSource: 'chain' | 'page';
  /** `agent`: the document was fetched by its hash by this browser just now. */
  documentSource: 'agent' | 'page';
}

async function hashFromChain(pda: string): Promise<Uint8Array | null> {
  try {
    return (await fetchHold(createConnection(), new PublicKey(pda)))?.evidenceHash ?? null;
  } catch {
    // RPC down, or the hold was closed after settlement and has no account.
    return null;
  }
}

function hashFromPage(hex: string): Uint8Array | null {
  try {
    const bytes = fromHex(hex);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

async function documentFromAgent(hash: Uint8Array): Promise<EvidenceDocument | null> {
  try {
    return (await createGuardian()?.evidence(toHex(hash))) ?? null;
  } catch {
    return null;
  }
}

/** Resolves with the comparison, or `null` when there is no hash or no document to compare. */
export async function verifyInBrowser(input: VerifyInput): Promise<VerifyResult | null> {
  const chainHash = await hashFromChain(input.pda);
  const hash = chainHash ?? hashFromPage(input.evidenceHash);
  if (!hash) return null;

  const fetched = await documentFromAgent(hash);
  const document = fetched ?? input.document;
  if (!document) return null;

  return {
    ...verifyReceipt(document, hash),
    hashSource: chainHash ? 'chain' : 'page',
    documentSource: fetched ? 'agent' : 'page',
  };
}
