import type { EvidenceItem, TierName } from '@holdback/sdk';

/** The strongest evidence first: the items that moved the score the most. */
export function topEvidence(evidence: readonly EvidenceItem[], count: number): EvidenceItem[] {
  return [...evidence].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, count);
}

/** Host of an `http(s)` URL, or `null` for anything else (the only links the app will open). */
export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  const match = /^https?:\/\/([^/?#:]+)/i.exec(url.trim());
  return match ? match[1]!.toLowerCase().replace(/^www\./, '') : null;
}

/** The site's own favicon, fetched straight from the source the evidence cites. */
export function faviconUrl(url: string | undefined): string | null {
  const host = hostOf(url);
  return host ? `https://${host}/favicon.ico` : null;
}

/** How loud the UI should be for a tier. Only the top two tiers are allowed to look alarming. */
export type Tone = 'calm' | 'neutral' | 'caution' | 'alert' | 'danger';

const TONE: Record<TierName, Tone> = {
  TRUSTED: 'calm',
  UNKNOWN: 'neutral',
  SUSPICIOUS: 'caution',
  FLAGGED: 'alert',
  SANCTIONED: 'danger',
};

export function toneOf(tier: TierName): Tone {
  return TONE[tier];
}

/** Tiers for which the spoken explanation plays by itself on the Hold screen. */
export function shouldAutoPlayVoiceNote(tier: TierName): boolean {
  return tier === 'SUSPICIOUS' || tier === 'FLAGGED';
}

/** Compares what the user typed with the confirmation phrase, ignoring case and extra spaces. */
export function phraseMatches(typed: string, phrase: string): boolean {
  const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return normalise(typed) !== '' && normalise(typed) === normalise(phrase);
}
