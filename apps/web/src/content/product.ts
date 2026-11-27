/**
 * Product facts shown on more than one page, written once. The wording
 * follows the repository's README and docs; the numbers come from the SDK.
 */
import { TIER_NAMES, Tier, WINDOW_SECS_BY_TIER, type TierName } from '@holdback/sdk';

export interface TierFact {
  tier: TierName;
  /** Plain-language name shown first; the program's name is shown second. */
  plain: string;
  when: string;
  windowSecs: number;
  extra?: string;
}

const WHEN: Record<TierName, { plain: string; when: string; extra?: string }> = {
  TRUSTED: {
    plain: 'Someone you trust',
    when: 'Your on-chain Trust account for this recipient exists.',
  },
  UNKNOWN: { plain: 'Someone new', when: 'The default: no warning signs found.' },
  SUSPICIOUS: { plain: 'Looks suspicious', when: 'The evidence scores 30 to 59.' },
  FLAGGED: {
    plain: 'Flagged wallet',
    when: 'The evidence scores 60 or more, or there is a confirmed scam report.',
  },
  SANCTIONED: {
    plain: 'On a sanctions list',
    when: 'The address is on the sanctions list.',
    extra: 'plus a typed confirmation',
  },
};

export const TIER_FACTS: TierFact[] = TIER_NAMES.map((tier) => ({
  tier,
  ...WHEN[tier],
  windowSecs: WINDOW_SECS_BY_TIER[Tier[tier]],
}));

export const STEPS: { name: string; text: string }[] = [
  {
    name: 'Assess',
    text: 'Eight collectors run in parallel: on-chain reputation, wallet-history heuristics, blocklists and the sanctions list, abuse reports, web reports that mention the exact address, name look-alikes, social-engineering cues in your own words, and your own payment habits.',
  },
  {
    name: 'Decide',
    text: 'A deterministic policy turns the evidence into a tier and a window. The language model never decides either; it only writes the spoken explanation.',
  },
  {
    name: 'Commit',
    text: 'The evidence document is hashed and the hash is written into the hold, so the window can be checked against the evidence forever.',
  },
  {
    name: 'Hold',
    text: 'You sign. Until the release time only you can move the funds, and only back to yourself.',
  },
  {
    name: 'Undo or settle',
    text: 'One signature undoes it. Otherwise anyone can release to the recipient once the window is over; a cranker does it every minute.',
  },
];

export const KEY_LIMITS: { key: string; can: string; cannot: string }[] = [
  {
    key: 'Risk oracle',
    can: 'Lengthen a running window (up to 72 hours after creation), raise the tier.',
    cannot: 'Move funds, shorten a window, re-lock a window that ended.',
  },
  {
    key: 'Relayer',
    can: 'Return a deposit box’s funds to its owner; open a hold whose sender is the owner, with at least the default window.',
    cannot: 'Pay itself or a third party, release early.',
  },
  {
    key: 'Admin',
    can: 'Rotate keys, change limits, pause new holds.',
    cannot: 'Touch any vault. Pausing never blocks undo or release.',
  },
];

export const INVARIANTS: string[] = [
  'Funds leave a vault only to the sender or the recipient.',
  'Nothing reaches the recipient early unless the sender signs.',
  'The oracle never moves funds or shortens a window.',
  'The relayer only pays the box owner or opens a hold for them.',
  'Supply is conserved.',
  'Every settled hold can be closed with its rent returned.',
];

export const COLLECTORS: { id: string; name: string; text: string }[] = [
  {
    id: 'onchain_reputation',
    name: 'On-chain reputation',
    text: 'The program’s own record of the recipient: flags, holds received, how many were undone and how many completed, and whether you have a Trust account for them.',
  },
  {
    id: 'helius',
    name: 'Wallet history',
    text: 'The recipient’s mainnet history: age, transaction count, first funder, and behaviour heuristics such as sweeping deposits onward or draining them within minutes.',
  },
  {
    id: 'blocklist',
    name: 'Blocklists and sanctions',
    text: 'Sanctioned addresses and a scam address list, matched exactly, plus phishing domains named in your note. If the sanctions list has never been loaded, the answer is "unavailable", not "not listed".',
  },
  {
    id: 'chainabuse',
    name: 'Abuse reports',
    text: 'Scam reports filed against the address.',
  },
  {
    id: 'web_reports',
    name: 'Web reports',
    text: 'A web search for the exact address with scam terms. A page counts only if its text contains the exact address; that is checked in code, before and after the model runs.',
  },
  {
    id: 'sns',
    name: 'Name look-alikes',
    text: 'The recipient’s .sol names, checked for imitation of well-known names.',
  },
  {
    id: 'context',
    name: 'Your own words',
    text: 'Your answer to "why are you sending this?", read for pressure and other cues in English, Hindi, Spanish and Portuguese. The note is read once and never stored.',
  },
  {
    id: 'baseline',
    name: 'Your own habits',
    text: 'Your HOLDBACK history: your typical amount, your usual time of day, and earlier payments to this recipient.',
  },
];

export const LIMITS: string[] = [
  'The window buys time and a warning. A sender who waits it out is not protected.',
  'Fee-on-transfer and transfer-hook mints are refused. Tokens an issuer can freeze can be stuck while frozen.',
  'Wallets that cannot sign program instructions depend on the relayer to undo.',
  'The program is on devnet and has not been audited.',
];
