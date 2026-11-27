import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { describeFailure } from '@/features/messages';
import { useSettings, useT } from '@/state/settings';
import { space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Notice } from '@/ui/Notice';
import { EmptyState } from '@/ui/Section';
import { useWallet } from '@/wallet/WalletContext';

/**
 * Shown when the app is past onboarding but has no wallet address: the
 * wallet's authorization was revoked or the email session ended. Offers the
 * way back in for whichever kind of wallet the user chose.
 */
export function ReconnectCard() {
  const t = useT();
  const wallet = useWallet();
  const kind = useSettings((state) => state.walletKind);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reconnect = async () => {
    if (kind === 'pollar') {
      wallet.pollar?.openLogin();
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await wallet.connectWallet();
      useSettings.getState().setWalletKind('mwa');
    } catch (error) {
      setMessage(describeFailure(error, t, 'hold').text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <EmptyState
        icon={kind === 'pollar' ? 'mail' : 'key'}
        title={kind === 'pollar' ? t('onboarding.pollarTitle') : t('onboarding.mwaTitle')}
        body={kind === 'pollar' ? t('pollar.signInFirst') : t('reconnect.body')}
        action={
          <Button
            label={kind === 'pollar' ? t('onboarding.pollarConnect') : t('onboarding.mwaConnect')}
            loading={busy}
            onPress={() => void reconnect()}
          />
        }
      />
      {message ? <Notice tone="caution" body={message} /> : null}
      <Button
        label={t('reconnect.startOver')}
        variant="ghost"
        onPress={() => void wallet.disconnect()}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
});
