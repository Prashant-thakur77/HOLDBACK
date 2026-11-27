/** What a voice session knows about its hold, and when to phone the sender. */
import { STATUS_NAMES, tierName, Tier, type EvidenceDocument, type Lang } from '@holdback/sdk';

import type { HoldRow } from '../db/holds';
import { getProfile } from '../db/profiles';
import { numberVar } from '../env';
import { usdValue } from '../lib/pricing';
import { spokenDuration } from '../llm/phrases';
import { templateSpoken } from '../llm/spoken';
import { shortAddress } from '../push/messages';
import type { Services } from '../services';
import type { DynamicVariables } from './agent-config';
import { outboundCall } from './elevenlabs';

const MAX_FINDINGS = 5;
const MAX_EVIDENCE = 6;
/** Default USD value above which a FLAGGED hold triggers a call. */
export const DEFAULT_CALL_MIN_USD = 100;
const CALL_ONCE_TTL_SECS = 4 * 86_400;

/** The dynamic variables for one hold, in the user's language where it is spoken text. */
export function sessionVariables(
  hold: HoldRow,
  document: EvidenceDocument | null,
  spoken: string | null,
  lang: Lang,
  now: Date,
): DynamicVariables {
  const secondsLeft = Math.max(0, Math.round((Date.parse(hold.release_at) - now.getTime()) / 1000));
  const pending = hold.status === 0;
  const findings = (document?.findings ?? [])
    .filter((finding) => finding.points !== 0)
    .slice(0, MAX_FINDINGS)
    .map((finding) => `${finding.title} (${finding.points} points)`);
  const evidence = (document?.evidence ?? [])
    .filter((item) => item.weight !== 0)
    .slice(0, MAX_EVIDENCE)
    .map((item) => `[${item.source}] ${item.detail}${item.quote ? ` Quote: "${item.quote}"` : ''}`);
  return {
    hold_pda: hold.pda,
    user_language: lang,
    tier: tierName(hold.tier),
    status: STATUS_NAMES[hold.status] ?? 'PENDING',
    recipient_short: shortAddress(hold.recipient),
    time_left: pending && secondsLeft > 0 ? spokenDuration(secondsLeft, lang) : 'none',
    can_undo: pending && secondsLeft > 0,
    score: document?.score ?? 0,
    spoken_summary: spoken ?? (document ? templateSpoken(document, lang) : 'not available'),
    findings_summary: findings.length > 0 ? findings.join('; ') : 'none',
    evidence_summary: evidence.length > 0 ? evidence.join(' | ') : 'none',
    checks_not_completed: document?.unavailable.length ?? 0,
  };
}

/**
 * Phones the sender about a FLAGGED (or worse) hold when they opted in with
 * a verified number and the payment is large enough. At most one call per
 * hold. Returns whether a call was placed.
 */
export async function maybeCallSender(
  services: Services,
  hold: HoldRow,
  document: EvidenceDocument | null,
): Promise<boolean> {
  const { env, db, cache } = services;
  if (!db || !env.ELEVENLABS_API_KEY || !env.ELEVENLABS_PHONE_NUMBER_ID) return false;
  if (hold.tier < Tier.FLAGGED || hold.status !== 0) return false;
  try {
    const profile = await getProfile(db, hold.sender);
    if (!profile?.phone || !profile.phone_verified) return false;
    const usd = hold.amount_usd ?? (await usdValue(services, hold.mint, BigInt(hold.amount)));
    if (usd === null || usd < numberVar(env.OUTBOUND_CALL_MIN_USD, DEFAULT_CALL_MIN_USD)) {
      return false;
    }
    if (!(await cache.claimOnce(`call:${hold.pda}`, CALL_ONCE_TTL_SECS))) return false;
    const lang = profile.lang ?? 'en';
    await outboundCall(
      env,
      profile.phone,
      lang,
      sessionVariables(hold, document, null, lang, new Date()),
    );
    return true;
  } catch {
    return false;
  }
}
