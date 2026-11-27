import { LANGS, type Lang } from '@holdback/sdk';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { config, hasAgent, hasSupabase } from '@/config';
import { useSeeker } from '@/data/chain';
import { useHolds } from '@/data/holds';
import { shareHistory, type ExportFormat } from '@/features/exportFile';
import { describeFailure } from '@/features/messages';
import { PhoneForm } from '@/features/PhoneForm';
import { LANGUAGE_NAMES, LOCALE_TAGS } from '@/i18n/translate';
import { shortAddress } from '@/lib/address';
import { maskPhone } from '@/lib/phone';
import { errorDetail } from '@/lib/walletErrors';
import {
  permissionStatus,
  registerForPush,
  unregisterFromPush,
  type PushStatus,
} from '@/push/notifications';
import { useLang, useSettings, useT } from '@/state/settings';
import { color, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { haptic } from '@/ui/haptics';
import { Icon, type IconName } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';
import { useWallet } from '@/wallet/WalletContext';
import { createWalletSession, useWalletSession } from '@/wallet/walletSession';

function Row({ icon, title, detail }: { icon: IconName; title: string; detail?: string }) {
  return (
    <View style={styles.row}>
      <Icon name={icon} size={18} tint={color.textMuted} />
      <View style={styles.flex}>
        <Text variant="bodyStrong">{title}</Text>
        {detail ? (
          <Text variant="small" tone="muted">
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function Settings() {
  const t = useT();
  const lang = useLang();
  const settings = useSettings();
  const wallet = useWallet();
  const seeker = useSeeker();
  const sent = useHolds('sender');
  const received = useHolds('recipient');
  const session = useWalletSession((state) => state.session);
  const { address, kind, pollar } = wallet;
  const own = address?.toBase58() ?? null;

  const [push, setPush] = useState<PushStatus | 'off' | 'unknown'>('unknown');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [editingPhone, setEditingPhone] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [goingLive, setGoingLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await permissionStatus().catch(() => 'undetermined' as const);
      if (cancelled) return;
      if (!settings.pushWanted) setPush('off');
      else if (status === 'denied') setPush('denied');
      else if (status === 'granted' && own) setPush(await registerForPush(own, lang));
      else setPush('off');
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.pushWanted, own, lang]);

  const enablePush = async () => {
    if (!own) return;
    settings.setPushWanted(true);
    setPush(await registerForPush(own, lang));
  };

  const exportAs = async (format: ExportFormat) => {
    if (!own) return;
    setExporting(format);
    try {
      const shared = await shareHistory(format, own, sent.data, received.data);
      if (!shared) toast(t('settings.exportEmpty'), 'neutral');
    } catch (error) {
      toast(t('settings.exportFailed', { detail: errorDetail(error) }), 'alert');
    } finally {
      setExporting(null);
    }
  };

  const goLive = async () => {
    if (!own) return;
    setGoingLive(true);
    try {
      await createWalletSession(own, wallet.signMessage);
      haptic.success();
    } catch (error) {
      const failure = describeFailure(error, t, 'hold');
      toast(failure.text, failure.cancelled ? 'neutral' : 'alert');
    } finally {
      setGoingLive(false);
    }
  };

  const pushDetail =
    push === 'registered'
      ? t('settings.notificationsOn')
      : push === 'denied'
        ? t('settings.notificationsDenied')
        : push === 'unavailable'
          ? t('settings.notificationsUnavailable')
          : t('settings.notificationsOff');
  const liveSession = session && session.wallet === own ? session : null;
  const relay = pollar?.state.session ?? null;
  const dateText = (iso: string) => new Date(iso).toLocaleString(LOCALE_TAGS[lang]);

  return (
    <Screen tabBarInset>
      <Text variant="title" accessibilityRole="header">
        {t('settings.title')}
      </Text>

      <Section title={t('settings.account')}>
        <Card style={styles.card}>
          <Row
            icon={kind === 'pollar' ? 'mail' : 'key'}
            title={kind === 'pollar' ? t('settings.walletPollar') : t('settings.walletMwa')}
            detail={
              own ? (seeker.data?.skrDomain ?? shortAddress(own, 6)) : t('common.unavailable')
            }
          />
          {seeker.data?.seekerOwner ? (
            <Row
              icon="award"
              title={t('home.seekerBadge')}
              detail={
                seeker.data.skrBalance
                  ? t('home.skrBalance', { amount: seeker.data.skrBalance })
                  : undefined
              }
            />
          ) : null}
          {kind === 'pollar' ? (
            <>
              <Row
                icon="box"
                title={t('settings.relaySession')}
                detail={
                  relay
                    ? t('settings.relayActive', { date: dateText(relay.expiresAt) })
                    : t('settings.relayNone')
                }
              />
              <Notice tone="neutral" icon="corner-up-left" body={t('pollar.note')} />
            </>
          ) : null}
          {kind === 'mwa' && hasAgent && hasSupabase ? (
            <>
              <Row
                icon="radio"
                title={t('settings.liveTitle')}
                detail={
                  liveSession
                    ? t('settings.relayActive', { date: dateText(liveSession.expiresAt) })
                    : t('settings.liveOff')
                }
              />
              {!liveSession ? (
                <Button
                  label={t('settings.liveEnable')}
                  variant="secondary"
                  compact
                  loading={goingLive}
                  onPress={() => void goLive()}
                />
              ) : null}
            </>
          ) : null}
          <View style={styles.buttons}>
            {own ? (
              <View style={styles.flex}>
                <Button
                  label={t('common.copy')}
                  variant="secondary"
                  compact
                  icon="copy"
                  onPress={() => {
                    void Clipboard.setStringAsync(own);
                    toast(t('common.copied'), 'calm');
                  }}
                />
              </View>
            ) : null}
            <View style={styles.flex}>
              <Button
                label={t('settings.disconnect')}
                variant="secondary"
                compact
                icon="log-out"
                onPress={() => setConfirmDisconnect(true)}
              />
            </View>
          </View>
        </Card>
      </Section>

      <Section title={t('settings.language')}>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {LANGS.map((code: Lang) => (
            <Chip
              key={code}
              label={LANGUAGE_NAMES[code]}
              selected={code === lang}
              onPress={() => settings.setLang(code)}
            />
          ))}
        </View>
      </Section>

      <Section title={t('settings.notifications')}>
        <Card style={styles.card}>
          <Row icon="bell" title={t('settings.notifications')} detail={pushDetail} />
          {push === 'denied' ? (
            <Button
              label={t('settings.openSystemSettings')}
              variant="secondary"
              compact
              onPress={() => void Linking.openSettings()}
            />
          ) : push === 'registered' ? (
            <Button
              label={t('settings.notificationsTurnOff')}
              variant="secondary"
              compact
              onPress={() => {
                settings.setPushWanted(false);
                void unregisterFromPush();
              }}
            />
          ) : push === 'off' ? (
            <Button
              label={t('settings.enable')}
              variant="secondary"
              compact
              onPress={() => void enablePush()}
            />
          ) : null}
        </Card>
      </Section>

      <Section title={t('settings.phone')}>
        <Card style={styles.card}>
          <Row
            icon="phone-call"
            title={settings.phone ? maskPhone(settings.phone) : t('settings.phoneNone')}
            detail={
              settings.phone
                ? settings.phoneVerified
                  ? t('settings.phoneVerified')
                  : t('settings.phoneUnverified')
                : t('onboarding.phoneBody')
            }
          />
          {editingPhone ? (
            <PhoneForm />
          ) : (
            <Button
              label={settings.phone ? t('settings.phoneChange') : t('settings.phoneAdd')}
              variant="secondary"
              compact
              onPress={() => setEditingPhone(true)}
            />
          )}
        </Card>
      </Section>

      <Section title={t('settings.exportTitle')}>
        <Card style={styles.card}>
          <Text variant="small" tone="muted">
            {t('settings.exportBody')}
          </Text>
          <View style={styles.buttons}>
            {(['csv', 'json'] as const).map((format) => (
              <View key={format} style={styles.flex}>
                <Button
                  label={format === 'csv' ? t('settings.exportCsv') : t('settings.exportJson')}
                  variant="secondary"
                  compact
                  icon="share"
                  loading={exporting === format}
                  disabled={exporting !== null}
                  onPress={() => void exportAs(format)}
                />
              </View>
            ))}
          </View>
        </Card>
      </Section>

      <Section title={t('settings.about')}>
        <Card style={styles.card}>
          <Row
            icon="cpu"
            title={t('settings.program')}
            detail={shortAddress(config.programId.toBase58(), 8)}
          />
          <Row
            icon="globe"
            title={t('settings.network')}
            detail={config.chain.replace('solana:', '')}
          />
          <Text variant="caption" tone="faint">
            {t('settings.version', { version: Constants.expoConfig?.version ?? '' })}
          </Text>
        </Card>
      </Section>

      <Sheet
        visible={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title={t('settings.disconnect')}
      >
        <Text variant="body" tone="muted">
          {t('settings.disconnectConfirm')}
        </Text>
        <Button
          label={t('settings.disconnect')}
          variant="danger"
          onPress={() => {
            setConfirmDisconnect(false);
            void wallet.disconnect();
          }}
        />
        <Button
          label={t('common.cancel')}
          variant="ghost"
          onPress={() => setConfirmDisconnect(false)}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  flex: { flex: 1 },
  buttons: { flexDirection: 'row', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
