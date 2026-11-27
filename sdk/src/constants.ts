import { PublicKey } from '@solana/web3.js';

import idl from './idl/holdback.json';

/** The deployed program. Read from the IDL so it can never drift from the build. */
export const PROGRAM_ID = new PublicKey(idl.address);

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);
export const BPF_LOADER_UPGRADEABLE_ID = new PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111',
);

/** Circle's devnet USDC mint, used by the demo. Any SPL or Token-2022 mint works. */
export const DEVNET_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

/** `Hold.mint` value that marks a native SOL hold. */
export const NATIVE_SOL_MINT = PublicKey.default;

export const SEEDS = {
  config: 'config',
  hold: 'hold',
  trust: 'trust',
  box: 'box',
  flag: 'flag',
  stats: 'stats',
} as const;

/** Risk tiers, in the order the program stores them. */
export const Tier = {
  TRUSTED: 0,
  UNKNOWN: 1,
  SUSPICIOUS: 2,
  FLAGGED: 3,
  SANCTIONED: 4,
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

export const TIER_NAMES = ['TRUSTED', 'UNKNOWN', 'SUSPICIOUS', 'FLAGGED', 'SANCTIONED'] as const;
export type TierName = (typeof TIER_NAMES)[number];

export const HoldStatus = { PENDING: 0, RELEASED: 1, RECLAIMED: 2 } as const;
export type HoldStatus = (typeof HoldStatus)[keyof typeof HoldStatus];
export const STATUS_NAMES = ['PENDING', 'RELEASED', 'RECLAIMED'] as const;

export const HoldOrigin = { WALLET: 0, DEPOSIT_BOX: 1 } as const;
export type HoldOrigin = (typeof HoldOrigin)[keyof typeof HoldOrigin];

/** Reason codes accepted by `flag_subject`. */
export const FlagReason = {
  OTHER: 0,
  PHISHING: 1,
  IMPERSONATION: 2,
  INVESTMENT_FRAUD: 3,
  ROMANCE: 4,
  FAKE_SUPPORT: 5,
  DRAINER: 6,
  EXTORTION: 7,
} as const;
export type FlagReason = (typeof FlagReason)[keyof typeof FlagReason];

/**
 * Undo window per tier, in seconds. This is the policy the risk agent
 * applies; the program only enforces the configured minimum and maximum.
 */
export const WINDOW_SECS_BY_TIER: Record<Tier, number> = {
  [Tier.TRUSTED]: 0,
  [Tier.UNKNOWN]: 1_800,
  [Tier.SUSPICIOUS]: 21_600,
  [Tier.FLAGGED]: 86_400,
  [Tier.SANCTIONED]: 259_200,
};

export function tierName(tier: number): TierName {
  return TIER_NAMES[tier] ?? 'UNKNOWN';
}
