import { LANGS, type Lang } from '@holdback/sdk';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import { hasAgent, hasPollar, hasSupabase } from '@/config';
import { PhoneForm } from '@/features/PhoneForm';
import { LANGUAGE_NAMES } from '@/i18n/translate';
import { WalletActionError } from '@/lib/walletErrors';
import { useSettings, useT } from '@/state/settings';
import { color, radius, space, tierColor } from '@/theme/tokens';
import { BrandMark } from '@/ui/BrandMark';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { CountdownRing } from '@/ui/CountdownRing';
import { Icon, type IconName } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { useWallet } from '@/wallet/WalletContext';
import { createWalletSession } from '@/wallet/walletSession';

type Step = 'hero' | 'wallet' | 'phone';

const HERO_WINDOW_MS = 9_000;

/** A ring that drains and refills, so the idea is on screen before a word is read. */
function HeroRing() {
  const [start, setStart] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setStart(Date.now()), HERO_WINDOW_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <CountdownRing
      size={220}
      strokeWidth={14}
      createdAt={start / 1000}
      releaseAt={(start + HERO_WINDOW_MS) / 1000}
      tint={color.lume}
      ticks
    >
      <BrandMark size={72} />
    </CountdownRing>
  );
}

function LanguagePicker() {
  const t = useT();
  const lang = useSettings((state) => state.lang);
  const setLang = useSettings((state) => state.setLang);
  return (
    <View
      style={styles.languages}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('onboarding.languageLabel')}
    >
      {LANGS.map((code: Lang) => (
        <Chip
          key={code}
          label={LANGUAGE_NAMES[code]}
          selected={code === lang}
          onPress={() => setLang(code)}
        />
      ))}
    </View>
  );
}

function WalletChoice({
  icon,
  title,
  body,
  note,
  tint,
  children,
}: {
  icon: IconName;
  title: string;
  body: string;
  note?: string;
  tint: string;
  children: ReactNode;
}) {
  return (
    <Card style={styles.choice}>
      <View style={styles.choiceHead}>
        <View style={[styles.choiceIcon, { backgroundColor: tint }]}>
          <Icon name={icon} size={20} tint={color.onBright} />
        </View>
        <Text variant="heading" style={styles.flex}>
          {title}
        </Text>
      </View>
      <Text variant="small" tone="muted">
        {body}
      </Text>
      {note ? <Notice tone="neutral" icon="corner-up-left" body={note} /> : null}
      {children}
    </Card>
  );
}

export default function Onboarding() {
  const t = useT();
  const router = useRouter();
  const wallet = useWallet();
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; quiet: boolean } | null>(null);
  const { pollar } = wallet;

  // The Pollar login happens in Pollar's own modal; move on once a Solana wallet exists.
  const pollarReady = settings.walletKind === 'pollar' && !!pollar?.signedIn && !!pollar.address;
  const [chosenStep, setStep] = useState<Step>('hero');
  const step: Step = chosenStep === 'wallet' && pollarReady ? 'phone' : chosenStep;

  const connectWallet = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const address = await wallet.connectWallet();
      settings.setWalletKind('mwa');
      // Optional: a signed session turns on live updates. Declining it changes nothing else.
      if (hasAgent && hasSupabase) {
        await createWalletSession(address.toBase58(), wallet.signMessage).catch(() => undefined);
      }
      setStep('phone');
    } catch (error) {
      const kind = error instanceof WalletActionError ? error.kind : 'failed';
      setMessage(
        kind === 'cancelled'
          ? { text: t('onboarding.cancelled'), quiet: true }
          : kind === 'no_wallet'
            ? { text: t('onboarding.noWallet'), quiet: false }
            : {
                text: t('onboarding.failed', {
                  detail: error instanceof Error ? error.message : '',
                }),
                quiet: false,
              },
      );
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    settings.completeOnboarding();
    router.replace('/');
  };

  return (
    <Screen contentStyle={styles.content}>
      {step === 'hero' ? (
        <Animated.View
          key="hero"
          entering={FadeIn.duration(400)}
          exiting={FadeOut}
          style={styles.step}
        >
          <View style={styles.heroRing}>
            <HeroRing />
          </View>
          <Text variant="hero">{t('onboarding.heroTitle')}</Text>
          <Text variant="body" tone="muted">
            {t('onboarding.heroBody')}
          </Text>
          <LanguagePicker />
          <Button
            label={t('onboarding.start')}
            icon="arrow-right"
            onPress={() => setStep('wallet')}
          />
        </Animated.View>
      ) : null}

      {step === 'wallet' ? (
        <Animated.View
          key="wallet"
          entering={FadeInDown.duration(320)}
          exiting={FadeOut}
          style={styles.step}
        >
          <Text variant="title">{t('onboarding.walletTitle')}</Text>
          <Text variant="small" tone="muted">
            {t('onboarding.walletBody')}
          </Text>

          <WalletChoice
            icon="key"
            title={t('onboarding.mwaTitle')}
            body={t('onboarding.mwaBody')}
            tint={color.lume}
          >
            <Button
              label={busy ? t('onboarding.connecting') : t('onboarding.mwaConnect')}
              loading={busy}
              onPress={() => void connectWallet()}
            />
          </WalletChoice>

          <WalletChoice
            icon="mail"
            title={t('onboarding.pollarTitle')}
            body={t('onboarding.pollarBody')}
            note={t('pollar.note')}
            tint={tierColor('UNKNOWN').fg}
          >
            {hasPollar && pollar ? (
              <Button
                label={t('onboarding.pollarConnect')}
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  settings.setWalletKind('pollar');
                  pollar.openLogin();
                }}
              />
            ) : (
              <Text variant="small" tone="faint">
                {t('onboarding.pollarMissing')}
              </Text>
            )}
            {settings.walletKind === 'pollar' && pollar?.signedIn && !pollar.address ? (
              <Notice tone="caution" body={t('pollar.noSolanaWallet')} />
            ) : null}
          </WalletChoice>

          {message ? (
            <Notice tone={message.quiet ? 'neutral' : 'caution'} body={message.text} />
          ) : null}
        </Animated.View>
      ) : null}

      {step === 'phone' ? (
        <Animated.View key="phone" entering={FadeInDown.duration(320)} style={styles.step}>
          <View style={styles.phoneIcon}>
            <Icon name="phone-call" size={28} tint={color.lume} />
          </View>
          <Text variant="title">{t('onboarding.phoneTitle')}</Text>
          <Text variant="body" tone="muted">
            {t('onboarding.phoneBody')}
          </Text>
          <PhoneForm onDone={finish} />
          <Button label={t('common.skip')} variant="ghost" onPress={finish} />
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center' },
  step: { gap: space.lg },
  flex: { flex: 1 },
  heroRing: { alignItems: 'center', paddingVertical: space.xl },
  languages: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  choice: { gap: space.md },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  choiceIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: color.lumeDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
