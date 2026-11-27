import { PublicKey } from '@solana/web3.js';

/** Parses a base58 public key, or returns `null`. Never throws. */
export function toPublicKey(text: string | null | undefined): PublicKey | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return null;
  try {
    return new PublicKey(trimmed);
  } catch {
    return null;
  }
}

export function isAddress(text: string | null | undefined): boolean {
  return toPublicKey(text) !== null;
}

/** `7xKX…gAsU`. Short text is returned unchanged. */
export function shortAddress(address: string, visible = 4): string {
  if (address.length <= visible * 2 + 1) return address;
  return `${address.slice(0, visible)}…${address.slice(-visible)}`;
}
