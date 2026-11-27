/**
 * The check behind the receipt's "verify hash" button. It is a pure function
 * with no network access and no server involvement: the browser hashes the
 * evidence document itself and compares the result with the 32 bytes stored
 * in the hold account. A match proves the undo window was set from exactly
 * this evidence under exactly this policy version.
 */
import { hashEvidence, toHex, verifyEvidence, type EvidenceDocument } from '@holdback/sdk';

export interface ReceiptVerification {
  /** Hex sha256 of the canonical JSON of the document, computed just now. */
  recomputedHash: string;
  /** Hex of the hash the caller read from the hold account. */
  onChainHash: string;
  matches: boolean;
}

export function verifyReceipt(
  document: EvidenceDocument,
  onChainHashBytes: Uint8Array,
): ReceiptVerification {
  return {
    recomputedHash: toHex(hashEvidence(document)),
    onChainHash: toHex(onChainHashBytes),
    matches: verifyEvidence(document, onChainHashBytes),
  };
}
