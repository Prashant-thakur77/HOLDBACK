/** Sends push notifications through Expo's push service. */
import type { Lang } from '@holdback/sdk';

import { getProfile } from '../db/profiles';
import type { HoldRow } from '../db/holds';
import { postJson } from '../lib/http';
import type { Services } from '../services';
import { pushText, type PushKind } from './messages';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export const holdDeepLink = (pda: string) => `holdback://hold/${pda}`;

export const isExpoToken = (token: string) => /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);

/**
 * Notifies the hold's sender about `kind`. Best effort: a wallet with no
 * registered device, or a push service error, is not an error for the
 * caller. Returns whether a notification was handed to Expo.
 */
export async function notifySender(
  services: Services,
  kind: PushKind,
  hold: Pick<HoldRow, 'pda' | 'sender' | 'recipient' | 'release_at'>,
): Promise<boolean> {
  if (!services.db) return false;
  try {
    const profile = await getProfile(services.db, hold.sender);
    if (!profile?.push_token) return false;
    const lang: Lang = profile.lang ?? 'en';
    const secondsLeft = Math.round((Date.parse(hold.release_at) - Date.now()) / 1000);
    const text = pushText(kind, lang, hold.recipient, secondsLeft);
    const token = services.env.EXPO_ACCESS_TOKEN;
    await postJson(
      EXPO_PUSH_URL,
      [
        {
          to: profile.push_token,
          title: text.title,
          body: text.body,
          sound: 'default',
          priority: 'high',
          channelId: 'holds',
          data: { url: holdDeepLink(hold.pda), hold: hold.pda, kind },
        },
      ],
      { timeoutMs: 5_000, headers: token ? { authorization: `Bearer ${token}` } : {} },
    );
    return true;
  } catch {
    return false;
  }
}
