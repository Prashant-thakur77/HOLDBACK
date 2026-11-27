/**
 * The HOLDBACK design system in one place.
 *
 * The idea is "time made visible": a dark instrument face on which the undo
 * window is a ring of light that drains. Colour is rationed. The lume green
 * belongs to the brand and to everything that is safe; warmer colours appear
 * only as the evidence gets worse, and red is kept for the two things that
 * deserve it: taking money back, and a recipient you should not pay.
 */
import type { TierName } from '@holdback/sdk';

import type { Tone } from '@/lib/evidence';

export const color = {
  /** Page background: near-black with a cold tint, like a watch dial. */
  ink: '#0B0D10',
  /** Cards. */
  surface: '#12151A',
  /** Inputs, pressed cards, chips. */
  raised: '#1A1E25',
  /** Sheets and the tab bar. */
  overlay: '#20252E',
  hairline: '#272D37',
  hairlineStrong: '#3A4250',

  text: '#F3F5F7',
  textMuted: '#A3ACBA',
  textFaint: '#6E7888',
  /** Text on top of a bright fill. */
  onBright: '#0B0D10',

  /** Brand: the lume on the dial. */
  lume: '#C6F36B',
  lumeDim: '#2A3518',
  ice: '#9CC2FF',
  iceDim: '#1A2535',
  amber: '#FFC15E',
  amberDim: '#35290F',
  ember: '#FF8A4C',
  emberDim: '#3A1F10',
  red: '#FF5A65',
  redDim: '#3B1519',

  scrim: 'rgba(5, 6, 8, 0.72)',
  transparent: 'transparent',
} as const;

/** Foreground and tinted background for each tone. Every pair passes 4.5:1 on `ink`. */
export const toneColor: Record<Tone, { fg: string; bg: string }> = {
  calm: { fg: color.lume, bg: color.lumeDim },
  neutral: { fg: color.ice, bg: color.iceDim },
  caution: { fg: color.amber, bg: color.amberDim },
  alert: { fg: color.ember, bg: color.emberDim },
  danger: { fg: color.red, bg: color.redDim },
};

const TIER_TONE: Record<TierName, Tone> = {
  TRUSTED: 'calm',
  UNKNOWN: 'neutral',
  SUSPICIOUS: 'caution',
  FLAGGED: 'alert',
  SANCTIONED: 'danger',
};

export function tierColor(tier: TierName): { fg: string; bg: string } {
  return toneColor[TIER_TONE[tier]];
}

/** 4-point spacing scale. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Font family names as registered in `app/_layout.tsx`. */
export const font = {
  display: 'BricolageGrotesque_700Bold',
  displayMedium: 'BricolageGrotesque_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodyBold: 'Inter_600SemiBold',
  /** Tabular digits for time, amounts and addresses, so a countdown does not jitter. */
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

/** Type ramp. Line heights leave room for Devanagari, which sits taller than Latin. */
export const type = {
  hero: { fontFamily: font.display, fontSize: 40, lineHeight: 46, letterSpacing: -1 },
  title: { fontFamily: font.display, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  heading: { fontFamily: font.displayMedium, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  body: { fontFamily: font.body, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: font.bodyBold, fontSize: 16, lineHeight: 24 },
  small: { fontFamily: font.body, fontSize: 14, lineHeight: 20 },
  smallStrong: { fontFamily: font.bodyBold, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: font.bodyMedium, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  overline: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  clock: { fontFamily: font.monoBold, fontSize: 44, lineHeight: 50, letterSpacing: -1 },
  amount: { fontFamily: font.monoBold, fontSize: 32, lineHeight: 38, letterSpacing: -0.5 },
  mono: { fontFamily: font.mono, fontSize: 14, lineHeight: 20 },
  monoSmall: { fontFamily: font.mono, fontSize: 12, lineHeight: 16 },
} as const;

export type TypeVariant = keyof typeof type;

/** Smallest touch target (dp). Android's guideline; every pressable is at least this tall. */
export const touch = { min: 48, comfortable: 56 } as const;

export const motion = {
  quick: 140,
  base: 240,
  slow: 420,
} as const;

/**
 * Colour of a countdown ring. A ring keeps its tier colour for its whole
 * life; it only turns red in the final minutes of a hold that already
 * carried a warning, which is the one moment urgency is the honest signal.
 */
export function ringTint(tier: TierName, urgency: 'calm' | 'soon' | 'final' | 'over'): string {
  const warned = tier === 'SUSPICIOUS' || tier === 'FLAGGED' || tier === 'SANCTIONED';
  if (urgency === 'final' && warned) return color.red;
  return tierColor(tier).fg;
}
