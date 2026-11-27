import { useEffect } from 'react';

import { ensureChannel, registerForPush, useNotificationRouting } from '@/push/notifications';
import { useLang, useSettings, useT } from '@/state/settings';
import { useWallet } from '@/wallet/WalletContext';
import { restoreWalletSession } from '@/wallet/walletSession';

/**
 * Background wiring that belongs to no screen: notification taps, the
 * notification channel, push registration and restoring a wallet session.
 * Renders nothing.
 */
export function AppEffects() {
  const t = useT();
  const lang = useLang();
  const { address, kind } = useWallet();
  const pushWanted = useSettings((state) => state.pushWanted);
  const onboarded = useSettings((state) => state.onboarded);
  const wallet = address?.toBase58() ?? null;

  useNotificationRouting();

  // The channel name is shown in Android settings, so it follows the app language.
  useEffect(() => {
    void ensureChannel(t('push.channelName'), t('push.channelDescription')).catch(() => undefined);
  }, [t]);

  // Re-register whenever the wallet or language changes: the agent sends in that language.
  useEffect(() => {
    if (onboarded && wallet && pushWanted) void registerForPush(wallet, lang);
  }, [onboarded, wallet, pushWanted, lang]);

  useEffect(() => {
    if (kind === 'mwa' && wallet) void restoreWalletSession(wallet);
  }, [kind, wallet]);

  return null;
}
