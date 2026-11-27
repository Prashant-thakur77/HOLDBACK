/**
 * Display helpers. Amount and duration formatting come from the SDK so the
 * web app, the mobile app and the agent print the same strings.
 */
import {
  HoldOrigin,
  HoldStatus,
  STATUS_NAMES,
  TIER_NAMES,
  explain,
  formatAmount,
  formatDuration,
  fromHex,
  parseAmount,
  type Hold,
  type HoldRecord,
  type TierName,
} from '@holdback/sdk';
import { PublicKey } from '@solana/web3.js';

import { SOL, mintMeta, type MintMeta } from './mints';

export { formatAmount, formatDuration, parseAmount };

/** `7xKX…gAsU`. */
export function shortAddress(address: string, edge = 4): string {
  return address.length <= edge * 2 + 1
    ? address
    : `${address.slice(0, edge)}…${address.slice(-edge)}`;
}

/** `12.5 USDC` from base units. Unknown mints print as `tokens` with no scaling. */
export function formatTokenAmount(amount: bigint | string, mint: MintMeta | null): string {
  const value = typeof amount === 'string' ? BigInt(amount) : amount;
  return `${formatAmount(value, mint?.decimals ?? 0)} ${mint?.symbol ?? 'tokens'}`;
}

/** Seconds from `now` until an ISO timestamp, never negative. */
export function secondsUntil(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000));
}

export function tierIndex(tier: TierName): number {
  return TIER_NAMES.indexOf(tier);
}

/** A mirrored or merged record as the decoded account shape the SDK's `explain` takes. */
function recordToHold(record: HoldRecord): Hold {
  const mint = record.mint ? new PublicKey(record.mint) : PublicKey.default;
  const sender = new PublicKey(record.sender);
  return {
    address: new PublicKey(record.pda),
    sender,
    recipient: new PublicKey(record.recipient),
    mint,
    amount: BigInt(record.amount),
    createdAt: Math.floor(Date.parse(record.createdAt) / 1000),
    releaseAt: Math.floor(Date.parse(record.releaseAt) / 1000),
    tier: tierIndex(record.tier) as Hold['tier'],
    evidenceHash: fromHex(record.evidenceHash),
    origin: record.origin === 'DEPOSIT_BOX' ? HoldOrigin.DEPOSIT_BOX : HoldOrigin.WALLET,
    status: STATUS_NAMES.indexOf(record.status) as HoldStatus,
    // `explain` does not read the fields below; they are filled to satisfy the type.
    rentPayer: sender,
    nonce: 0n,
    bump: 0,
    isSol: record.mint === null,
  };
}

/** One plain sentence about where a hold stands, from the SDK's `explain`. */
export function explainRecord(record: HoldRecord, now: number = Date.now()): string {
  const meta = record.mint === null ? SOL : mintMeta(record.mint);
  return explain(recordToHold(record), {
    now: Math.floor(now / 1000),
    symbol: meta?.symbol,
    decimals: meta?.decimals,
  });
}
