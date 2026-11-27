import type { Lang } from '@holdback/sdk';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { hasAgent } from '@/config';
import { guardian } from '@/data/guardian';
import { routeFor, targetFromNotification } from '@/lib/deeplink';
import { color } from '@/theme/tokens';

export const HOLDS_CHANNEL = 'holds';

export type PushStatus =
  /** Token registered with the agent. */
  | 'registered'
  /** The user (or Android) has notifications switched off for this app. */
  | 'denied'
  /** No Expo project id or Firebase configuration in this build, an emulator, or no agent. */
  | 'unavailable';

/** Show notifications while the app is open too: a hold changing is worth interrupting for. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureChannel(name: string, description: string): Promise<void> {
  await Notifications.setNotificationChannelAsync(HOLDS_CHANNEL, {
    name,
    description,
    importance: AndroidImportance.HIGH,
    lightColor: color.lume,
    vibrationPattern: [0, 200, 120, 200],
  });
}

export async function permissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Asks for permission if needed, gets this install's Expo push token and
 * registers it with the agent for `wallet`. The agent sends through the Expo
 * push service, which delivers over FCM, so the build needs both an Expo
 * project id and the Firebase file. Never throws: push is optional, and the
 * caller only needs to know which of the three states it ended in.
 */
export async function registerForPush(wallet: string, lang: Lang): Promise<PushStatus> {
  const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId;
  if (!hasAgent || !Device.isDevice || typeof projectId !== 'string') return 'unavailable';
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return 'denied';

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    await guardian.registerPush({ wallet, pushToken: token.data, lang });
    return 'registered';
  } catch {
    return 'unavailable';
  }
}

/** Stops delivery to this install by giving up its push token. */
export async function unregisterFromPush(): Promise<void> {
  await Notifications.unregisterForNotificationsAsync().catch(() => undefined);
}

/**
 * Opens the right screen when a notification is tapped, including the one
 * that launched the app. Mounted once, inside the router.
 */
export function useNotificationRouting(): void {
  const router = useRouter();

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      const target = targetFromNotification(response?.notification.request.content.data);
      if (target) router.push(routeFor(target) as never);
    };

    const last = Notifications.getLastNotificationResponse();
    if (last) {
      open(last);
      Notifications.clearLastNotificationResponse();
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [router]);
}
