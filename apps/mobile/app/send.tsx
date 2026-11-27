import { buildCreateHoldTx } from '@holdback/sdk';
import { PublicKey } from '@solana/web3.js';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { hasAgent } from '@/config';
import { useBalances, useIsTrusted, useProgramConfig } from '@/data/chain';
import { SOL, usePaymentToken, type TokenMeta } from '@/data/tokens';
import { describeFailure } from '@/features/messages';
import { QrScanner } from '@/features/QrScanner';
import { DictateButton } from '@/features/send/DictateButton';
import {
  holdTerms,
  useAssessment,
  usePreview,
  useRecipient,
  type RecipientState,
} from '@/features/send/hooks';
import { PreviewCard } from '@/features/send/PreviewCard';
import { VerdictCard, type VerdictState } from '@/features/send/VerdictCard';
import { formatWindow, type Translate } from '@/i18n/translate';
import { shortAddress } from '@/lib/address';
import { formatUnits, sanitizeAmountInput, validateAmount } from '@/lib/amount';
import { phraseMatches } from '@/lib/evidence';
import { clampWindow, isInstant, windowBounds, windowOptions } from '@/lib/window';
import { useLang, useT } from '@/state/settings';
import { color, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { Field } from '@/ui/Field';
import { haptic } from '@/ui/haptics';
import { Header, IconButton } from '@/ui/Header';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';
import { useHoldActions } from '@/wallet/useHoldActions';
import { useWallet } from '@/wallet/WalletContext';

/** Lamports kept back when "Max" is used for SOL, so the fee and rent can still be paid. */
const SOL_RESERVE = 10_000_000n;

function recipientNote(state: RecipientState, own: string | null, t: Translate) {
  switch (state.status) {
    case 'invalid':
      return { error: t('send.recipientInvalid') };
    case 'resolving':
      return { hint: t('send.resolving', { name: state.name }) };
    case 'not_found':
      return { error: t('send.nameNotFound', { name: state.name }) };
    case 'unavailable':
      return { error: t('errors.notConfigured') };
    case 'ready':
      if (state.address === own) return { error: t('send.selfSend') };
      return state.name
        ? { hint: t('send.resolved', { name: state.name, address: shortAddress(state.address) }) }
        : {};
    default:
      return {};
  }
}

export default function Send() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const params = useLocalSearchParams<{ to?: string; amount?: string }>();
  const wallet = useWallet();
  const actions = useHoldActions();
  const programConfig = useProgramConfig();
  const balances = useBalances();
  const paymentToken = usePaymentToken();
  const { address, kind, pollar } = wallet;
  const own = address?.toBase58() ?? null;
  const isPollar = kind === 'pollar';

  const [recipientText, setRecipientText] = useState(params.to ?? '');
  const [amountText, setAmountText] = useState(params.amount ?? '');
  const [why, setWhy] = useState('');
  const [useSol, setUseSol] = useState(false);
  const [chosenWindow, setChosenWindow] = useState<number | null>(null);
  const [phrase, setPhrase] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<'signing' | null>(null);
  const [failure, setFailure] = useState<ReturnType<typeof describeFailure> | null>(null);

  /** Editing the form clears the message about the previous attempt. */
  const edit =
    <T,>(apply: (value: T) => void) =>
    (value: T) => {
      setFailure(null);
      apply(value);
    };

  // Email accounts pay in the payment token only: the deposit box is a token account.
  const token: TokenMeta | undefined = useSol && !isPollar ? SOL : paymentToken;
  const balance = token ? (token.mint ? balances.data?.token : balances.data?.sol) : undefined;
  const spendable =
    balance === undefined
      ? null
      : token?.mint
        ? balance + (isPollar ? (balances.data?.box ?? 0n) : 0n)
        : balance > SOL_RESERVE
          ? balance - SOL_RESERVE
          : 0n;

  const recipient = useRecipient(recipientText);
  const recipientAddress =
    recipient.status === 'ready' && recipient.address !== own ? recipient.address : null;
  const parsed = token ? validateAmount(amountText, token.decimals, spendable) : null;
  const amount = parsed?.ok ? parsed.value : null;

  const assessment = useAssessment({
    recipient: recipientAddress,
    mint: token?.mint ?? null,
    amount,
    context: why,
    lang,
  });
  const trusted = useIsTrusted(isPollar ? null : recipientAddress) ?? false;

  // Without a verdict the program's default window applies; an email account always needs the agent.
  const { minWindowSecs, maxWindowSecs, defaultWindowSecs } = programConfig;
  const policySecs = assessment.data?.windowSecs ?? defaultWindowSecs;
  const windowInputs = useMemo(
    () => ({
      // The relayer may not open a hold shorter than the program's default window.
      policySecs: isPollar ? Math.max(policySecs, defaultWindowSecs) : policySecs,
      trusted,
      minSecs: minWindowSecs,
      maxSecs: maxWindowSecs,
    }),
    [isPollar, policySecs, trusted, minWindowSecs, maxWindowSecs, defaultWindowSecs],
  );
  const bounds = windowBounds(windowInputs);
  const options = windowOptions(windowInputs);
  // The user's choice is honoured only inside the allowed range; a new verdict can raise the floor.
  const windowSecs = clampWindow(chosenWindow ?? windowInputs.policySecs, bounds);

  const ready = !!recipientAddress && amount !== null && !!token;
  const verdict: VerdictState = !ready
    ? { status: 'idle' }
    : assessment.data
      ? { status: 'ready', assessment: assessment.data }
      : assessment.isError || !hasAgent
        ? { status: 'failed' }
        : { status: 'loading' };

  const preview = usePreview({
    recipient: recipientAddress,
    token,
    amount,
    windowSecs,
    assessment: assessment.data,
    enabled: ready && !isPollar && verdict.status !== 'loading',
  });

  const needsPhrase = assessment.data?.requiresConfirmation === true;
  const phraseOk = !needsPhrase || phraseMatches(phrase, t('send.sanctionPhrase'));
  const needsProof = isPollar && !pollar?.state.session;
  const blocked =
    !ready ||
    !phraseOk ||
    programConfig.paused ||
    verdict.status === 'loading' ||
    preview.status === 'failed' ||
    preview.status === 'loading' ||
    (preview.status === 'ok' && preview.verdict.mismatch) ||
    (isPollar && (!hasAgent || verdict.status === 'failed'));

  const prove = async () => {
    if (!pollar || !own || !paymentToken?.mint) return;
    setFailure(null);
    try {
      await pollar.flow.authenticate(own, paymentToken.mint);
      haptic.success();
      void balances.refetch();
    } catch (error) {
      setFailure(describeFailure(error, t, 'send'));
      haptic.error();
    }
  };

  const submit = async () => {
    if (!ready || !address || !recipientAddress || amount === null || !token) return;
    setFailure(null);
    setBusy('signing');
    try {
      let hold: string | null;
      if (isPollar) {
        if (!pollar) return;
        const opened = await pollar.flow.send({
          recipient: recipientAddress,
          amount,
          context: why.trim() || undefined,
          lang,
          // Only ask for a specific window when the user made it longer than the policy.
          windowSecs: windowSecs > policySecs ? windowSecs : undefined,
        });
        hold = opened.hold;
      } else {
        let created: PublicKey | null = null;
        await wallet.signAndConfirm(async (connection) => {
          const built = await buildCreateHoldTx(connection, {
            sender: address,
            recipient: new PublicKey(recipientAddress),
            mint: token.mint ? new PublicKey(token.mint) : null,
            amount,
            windowSecs,
            ...holdTerms(assessment.data),
          });
          created = built.hold;
          return built;
        });
        hold = (created as PublicKey | null)?.toBase58() ?? null;
      }
      haptic.success();
      await actions.refresh();
      if (hold) {
        toast(t('send.held'), 'calm');
        router.replace(`/hold/${hold}`);
      } else {
        toast(t('send.sentInstant', { name: shortAddress(recipientAddress) }), 'calm');
        router.back();
      }
    } catch (error) {
      const message = describeFailure(error, t, 'send');
      setFailure(message);
      if (message.cancelled) haptic.tap();
      else haptic.error();
    } finally {
      setBusy(null);
    }
  };

  const pollarStep = pollar && pollar.state.activity !== 'idle' ? pollar.state.activity : null;
  const working = busy !== null || pollarStep !== null;
  const signLabel = pollarStep
    ? t(`pollar.step.${pollarStep}`)
    : busy
      ? t('send.signing')
      : isInstant(windowSecs)
        ? t('send.signInstant')
        : t('send.signHold', { window: formatWindow(windowSecs, t) });

  return (
    <Screen
      footer={
        needsProof ? (
          <Button
            label={pollarStep ? t(`pollar.step.${pollarStep}`) : t('pollar.proveCta')}
            loading={pollarStep !== null}
            disabled={!hasAgent}
            onPress={() => void prove()}
          />
        ) : (
          <Button
            label={signLabel}
            variant={assessment.data?.tier === 'SANCTIONED' ? 'danger' : 'primary'}
            icon={working ? undefined : isInstant(windowSecs) ? 'fast-forward' : 'clock'}
            loading={working}
            disabled={blocked}
            onPress={() => void submit()}
          />
        )
      }
    >
      <Header title={t('send.title')} />

      {programConfig.deployed === false ? (
        <Notice tone="caution" body={t('send.notDeployed')} />
      ) : programConfig.paused ? (
        <Notice tone="caution" body={t('send.paused')} />
      ) : null}

      {needsProof ? (
        <Card style={styles.block}>
          <Text variant="heading">{t('pollar.proveTitle')}</Text>
          <Text variant="small" tone="muted">
            {t('pollar.proveBody')}
          </Text>
          <Notice tone="neutral" icon="corner-up-left" body={t('pollar.note')} />
        </Card>
      ) : null}

      <Field
        label={t('send.recipientLabel')}
        placeholder={t('send.recipientPlaceholder')}
        value={recipientText}
        onChangeText={edit(setRecipientText)}
        autoCapitalize="none"
        autoCorrect={false}
        mono
        {...recipientNote(recipient, own, t)}
        accessory={
          <>
            <IconButton
              icon="clipboard"
              label={t('common.paste')}
              onPress={() =>
                void Clipboard.getStringAsync().then(
                  (text) => text && setRecipientText(text.trim()),
                )
              }
            />
            <IconButton icon="maximize" label={t('send.scan')} onPress={() => setScanning(true)} />
          </>
        }
      />
      {recipient.status === 'ready' && recipient.lookalikeOf ? (
        <Notice tone="alert" body={t('send.lookalike', { name: recipient.lookalikeOf })} />
      ) : null}

      <View style={styles.block}>
        <Field
          label={t('send.amountLabel')}
          placeholder="0.00"
          value={amountText}
          onChangeText={edit((text: string) => setAmountText(sanitizeAmountInput(text)))}
          keyboardType="decimal-pad"
          large
          error={
            amountText !== '' && parsed && !parsed.ok
              ? t(`send.amountError.${parsed.error}`, { symbol: token?.symbol ?? '' })
              : null
          }
          hint={
            token && spendable !== null
              ? t('send.balance', {
                  amount: formatUnits(spendable, token.decimals, 4),
                  symbol: token.symbol,
                })
              : undefined
          }
          accessory={
            token && spendable !== null && spendable > 0n ? (
              <Chip
                label={t('send.max')}
                onPress={() =>
                  setAmountText(formatUnits(spendable, token.decimals).replace(/,/g, ''))
                }
              />
            ) : undefined
          }
        />
        {!isPollar && paymentToken ? (
          <View style={styles.chips} accessibilityRole="radiogroup">
            <Chip label={paymentToken.symbol} selected={!useSol} onPress={() => setUseSol(false)} />
            <Chip label="SOL" selected={useSol} onPress={() => setUseSol(true)} />
          </View>
        ) : null}
        {isPollar && paymentToken ? (
          <Text variant="caption" tone="faint">
            {t('pollar.onlyToken', { symbol: paymentToken.symbol })}
          </Text>
        ) : null}
      </View>

      <Field
        label={t('send.whyLabel')}
        placeholder={t('send.whyPlaceholder')}
        hint={t('send.whyHint')}
        value={why}
        onChangeText={setWhy}
        multiline
        maxLength={500}
        accessory={<DictateButton onText={setWhy} />}
      />

      <VerdictCard state={verdict} />

      {ready && verdict.status !== 'loading' ? (
        <View style={styles.block}>
          <Text variant="overline" tone="muted">
            {t('send.windowLabel')}
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {options.map((secs) => (
              <Chip
                key={secs}
                label={formatWindow(secs, t)}
                selected={secs === windowSecs}
                tint={isInstant(secs) ? color.amber : color.lume}
                onPress={() => setChosenWindow(secs)}
              />
            ))}
          </View>
          <Text variant="small" tone="muted">
            {trusted
              ? t('send.windowTrusted')
              : t('send.windowFloor', { window: formatWindow(bounds.floor, t) })}
          </Text>
        </View>
      ) : null}

      {ready && token ? (
        isPollar ? (
          <Notice
            tone="neutral"
            icon="corner-up-left"
            body={`${t('send.previewPollar', {
              amount: formatUnits(amount ?? 0n, token.decimals),
              symbol: token.symbol,
            })} ${t('pollar.note')}`}
          />
        ) : (
          <PreviewCard state={preview} token={token} windowSecs={windowSecs} />
        )
      ) : null}

      {needsPhrase ? (
        <Card accent={color.red} style={styles.block}>
          <Text variant="heading" tone={color.red}>
            {t('send.sanctionTitle')}
          </Text>
          <Text variant="small">{t('tierHint.SANCTIONED')}</Text>
          <Text variant="small" tone="muted">
            {t('send.sanctionBody')}
          </Text>
          <Text variant="mono" selectable>
            {t('send.sanctionPhrase')}
          </Text>
          <Field
            label={t('send.sanctionPlaceholder')}
            value={phrase}
            onChangeText={setPhrase}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Card>
      ) : null}

      {failure ? <Notice tone={failure.tone} body={failure.text} /> : null}

      <QrScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onResult={(payment) => {
          setScanning(false);
          setRecipientText(payment.recipient);
          if (payment.amount) setAmountText(payment.amount);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
