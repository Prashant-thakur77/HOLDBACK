import type { Trust } from '@holdback/sdk';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { useTrustedPeople } from '@/data/chain';
import { describeFailure } from '@/features/messages';
import { QrScanner } from '@/features/QrScanner';
import { useRecipient } from '@/features/send/hooks';
import { LOCALE_TAGS } from '@/i18n/translate';
import { shortAddress, toPublicKey } from '@/lib/address';
import { useLang, useT } from '@/state/settings';
import { color, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Field } from '@/ui/Field';
import { haptic } from '@/ui/haptics';
import { Header, IconButton } from '@/ui/Header';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { EmptyState, Section } from '@/ui/Section';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';
import { useHoldActions } from '@/wallet/useHoldActions';
import { useWallet } from '@/wallet/WalletContext';

export default function TrustedPeople() {
  const t = useT();
  const lang = useLang();
  const { address, kind } = useWallet();
  const actions = useHoldActions();
  const people = useTrustedPeople();
  const [text, setText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Trust | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const recipient = useRecipient(text);
  const own = address?.toBase58();
  const target =
    recipient.status === 'ready' && recipient.address !== own ? recipient.address : null;
  const already =
    !!target && (people.data ?? []).some((trust) => trust.recipient.toBase58() === target);

  const act = async (task: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      haptic.success();
      toast(done, 'calm');
      setText('');
    } catch (error) {
      const failure = describeFailure(error, t, 'hold');
      setMessage(failure.text);
      if (!failure.cancelled) haptic.error();
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  const fieldNote =
    recipient.status === 'invalid'
      ? { error: t('send.recipientInvalid') }
      : recipient.status === 'not_found'
        ? { error: t('send.nameNotFound', { name: recipient.name }) }
        : recipient.status === 'resolving'
          ? { hint: t('send.resolving', { name: recipient.name }) }
          : recipient.status === 'ready' && recipient.address === own
            ? { error: t('send.selfSend') }
            : already
              ? { hint: t('trusted.alreadyTrusted') }
              : {};

  return (
    <Screen onRefresh={() => void people.refetch()} refreshing={people.isRefetching}>
      <Header title={t('trusted.title')} />
      <Text variant="small" tone="muted">
        {t('trusted.body')}
      </Text>

      {kind === 'pollar' ? (
        <Notice tone="neutral" body={t('trusted.pollar')} />
      ) : (
        <Card style={styles.block}>
          <Field
            label={t('trusted.addTitle')}
            placeholder={t('send.recipientPlaceholder')}
            value={text}
            onChangeText={setText}
            autoCapitalize="none"
            autoCorrect={false}
            mono
            {...fieldNote}
            accessory={
              <>
                <IconButton
                  icon="clipboard"
                  label={t('common.paste')}
                  onPress={() =>
                    void Clipboard.getStringAsync().then((value) => value && setText(value.trim()))
                  }
                />
                <IconButton
                  icon="maximize"
                  label={t('send.scan')}
                  onPress={() => setScanning(true)}
                />
              </>
            }
          />
          {recipient.status === 'ready' && recipient.lookalikeOf ? (
            <Notice tone="alert" body={t('send.lookalike', { name: recipient.lookalikeOf })} />
          ) : null}
          <Button
            label={busy ? t('trusted.adding') : t('trusted.addCta')}
            icon="user-check"
            loading={busy && !removing}
            disabled={!target || already || busy}
            onPress={() => {
              const key = toPublicKey(target);
              if (key) void act(() => actions.trust(key), t('trusted.added'));
            }}
          />
        </Card>
      )}

      {message ? <Notice tone="caution" body={message} /> : null}

      <Section title={t('trusted.title')}>
        {people.isLoading ? (
          <ActivityIndicator color={color.lume} />
        ) : (people.data ?? []).length === 0 ? (
          <Card>
            <EmptyState
              icon="users"
              title={t('trusted.emptyTitle')}
              body={t('trusted.emptyBody')}
            />
          </Card>
        ) : (
          <View style={styles.list}>
            {(people.data ?? []).map((trust) => {
              const who = trust.recipient.toBase58();
              return (
                <Animated.View
                  key={who}
                  entering={FadeInDown.duration(240)}
                  exiting={FadeOut.duration(160)}
                  layout={LinearTransition}
                >
                  <Card style={styles.person}>
                    <View style={styles.avatar}>
                      <Icon name="user-check" size={18} tint={color.lume} />
                    </View>
                    <View style={styles.flex}>
                      <Text variant="mono">{shortAddress(who, 6)}</Text>
                      <Text variant="caption" tone="faint">
                        {t('trusted.since', {
                          date: new Date(trust.createdAt * 1000).toLocaleDateString(
                            LOCALE_TAGS[lang],
                          ),
                        })}
                      </Text>
                    </View>
                    {kind === 'mwa' ? (
                      <IconButton
                        icon="user-x"
                        label={`${t('common.remove')} ${shortAddress(who)}`}
                        tint={color.textMuted}
                        onPress={() => setRemoving(trust)}
                      />
                    ) : null}
                  </Card>
                </Animated.View>
              );
            })}
          </View>
        )}
      </Section>

      <Sheet
        visible={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('common.remove')}
      >
        <Text variant="body" tone="muted">
          {t('trusted.removeConfirm', {
            name: removing ? shortAddress(removing.recipient.toBase58()) : '',
          })}
        </Text>
        <Button
          label={t('common.remove')}
          variant="danger"
          loading={busy}
          onPress={() => {
            if (removing) void act(() => actions.untrust(removing.recipient), t('trusted.removed'));
          }}
        />
        <Button label={t('common.cancel')} variant="ghost" onPress={() => setRemoving(null)} />
      </Sheet>

      <QrScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onResult={(payment) => {
          setScanning(false);
          setText(payment.recipient);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.md },
  list: { gap: space.sm },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.lumeDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1, gap: space.xxs },
});
