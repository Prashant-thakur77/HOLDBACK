/**
 * The evidence document and its hash.
 *
 * The risk agent stores one document per assessment and writes
 * `sha256(canonicalJson(document))` on-chain in `Hold.evidence_hash`. Anyone
 * can fetch the document, recompute the hash with `hashEvidence` and compare
 * it with the chain, which proves the window was set from exactly this
 * evidence by exactly this policy version.
 */
import { sha256 } from '@noble/hashes/sha256';

import type { TierName } from './constants';

/** One raw observation from one source. */
export interface EvidenceItem {
  /** Collector id, e.g. `onchain_reputation`, `blocklist`, `web_reports`. */
  source: string;
  /** Machine-readable signal, e.g. `reclaimed_against_ratio`. */
  signal: string;
  /** Points this item contributes to the score. Negative values lower risk. */
  weight: number;
  /** One plain-language sentence. */
  detail: string;
  /** Where a person can check it. */
  url?: string;
  /** For web sources: a short quote and the exact identifier it mentions. */
  quote?: string;
  matched?: string;
  /** ISO date of the underlying report, when known. */
  date?: string;
}

/** A scored conclusion drawn from one or more evidence items. */
export interface Finding {
  id: string;
  title: string;
  points: number;
  level: 'info' | 'warning' | 'critical';
  /** Indexes into `evidence`. */
  evidence: number[];
}

/** The complete, hashed record of one assessment. */
export interface EvidenceDocument {
  policyVersion: string;
  /** ISO timestamp of the assessment. */
  assessedAt: string;
  sender: string;
  recipient: string;
  /** Mint address, or `SOL`. */
  mint: string;
  /** Base units, as a decimal string. */
  amount: string;
  score: number;
  tier: TierName;
  windowSecs: number;
  findings: Finding[];
  evidence: EvidenceItem[];
  /** Collectors that could not answer in time. They add no points. */
  unavailable: string[];
}

/**
 * Deterministic JSON: object keys sorted, no whitespace, `undefined` dropped.
 * Two documents with the same content always produce the same string.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error('Evidence cannot contain NaN or Infinity');
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new Error(`Evidence cannot contain a ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',');
  return `{${body}}`;
}

/** sha256 of the canonical JSON, as the 32 bytes stored on-chain. */
export function hashEvidence(document: EvidenceDocument): Uint8Array {
  return sha256(new TextEncoder().encode(canonicalJson(document)));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error('Invalid hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** True when `document` hashes to `expected` (bytes or hex). */
export function verifyEvidence(document: EvidenceDocument, expected: Uint8Array | string): boolean {
  const want =
    typeof expected === 'string' ? expected.replace(/^0x/, '').toLowerCase() : toHex(expected);
  return toHex(hashEvidence(document)) === want;
}
