import { FlagReason, type HoldRecord } from '@holdback/sdk';
import { PublicKey } from '@solana/web3.js';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { explorerUrl, hasAgent } from '@/config';
import { useHasReported } from '@/data/chain';
import { guardian } from '@/data/guardian';
import { useHold } from '@/data/holds';
import { useTokenMeta } from '@/data/tokens';
import { EvidenceList } from '@/features/EvidenceList';
import { describeFailure, type FailureMessage } from '@/features/messages';
import { VoiceNote } from '@/features/VoiceNote';
import { shortAddress } from '@/lib/address';
import { formatUnits } from '@/lib/amount';
import { formatClock, remainingSecs, totalWindowSecs, urgency } from '@/lib/countdown';
import { shouldAutoPlayVoiceNote } from '@/lib/evidence';
import { holdPhase } from '@/lib/holds';
import { useNow } from '@/state/clock';
import { useLang, useT } from '@/state/settings';
import { color, radius, ringTint, space, touch } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { CountdownRing } from '@/ui/CountdownRing';
import { playSound } from '@/ui/sounds';
import { haptic } from '@/ui/haptics';
import { Header, IconButton } from '@/ui/Header';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { EmptyState, Section } from '@/ui/Section';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { TierBadge } from '@/ui/TierBadge';
import { toast } from '@/ui/Toast';
import { GuardianCall } from '@/voice/GuardianCall';
import { useHoldActions } from '@/wallet/useHoldActions';
import { useWallet } from '@/wallet/WalletContext';

type Confirming = 'undo' | 'release' | 'report' | null;
type Working = 'undo' | 'release' | 'report' | null;

const REASONS = [
  'PHISHING',
  'IMPERSONATION',
  'INVESTMENT_FRAUD',
  'ROMANCE',
  'FAKE_SUPPORT',
  'DRAINER',
  'EXTORTION',
  'OTHER',
] as const satisfies readonly (keyof typeof FlagReason)[];

function Party({ label, address }: { label: string; address: string }) {
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${address}. ${t('common.copy')}`}
      onPress={() => {
        haptic.tap();
        void Clipboard.setStringAsync(address);
        toast(t('common.copied'), 'calm');
      }}
      style={styles.party}
    >
      <Text variant="caption" tone="faint">
        {label}
      </Text>
      <Text variant="mono">{shortAddress(address, 6)}</Text>
    </Pressable>
  );
}

export default function HoldDetail() {
  const t = useT();
  const lang = useLang();
  const now = useNow();
  const { pda } = useLocalSearchParams<{ pda: string }>();
  const { address, kind } = useWallet();
  const actions = useHoldActions();
  const query = useHold(pda);
  const receipt = query.data;
  const token = useTokenMeta(receipt?.hold.mint);
  const alreadyReported = useHasReported(receipt?.hold.recipient ?? null);

  const [confirming, setConfirming] = useState<Confirming>(null);
  const [working, setWorking] = useState<Working>(null);
  const [failure, setFailure] = useState<FailureMessage | null>(null);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('PHISHING');
  const [calling, setCalling] = useState(false);

  if (query.isLoading) {
    return (
      <Screen>
        <Header title={t('hold.title')} />
        <ActivityIndicator color={color.lume} style={styles.loading} />
      </Screen>
    );
  }
  if (!receipt) {
    return (
      <Screen>
        <Header title={t('hold.title')} />
        <EmptyState icon="search" title={t('hold.title')} body={t('hold.notFound')} />
      </Screen>
    );
  }

  const hold: HoldRecord = receipt.hold;
  const own = address?.toBase58();
  const isSender = own === hold.sender;
  const isWalletUser = kind === 'mwa';
  const phase = holdPhase(hold, now);
  const remaining = remainingSecs(hold.releaseAt, now);
  const level = urgency(remaining, totalWindowSecs(hold.createdAt, hold.releaseAt));
  const tint =
    phase === 'undoable' || phase === 'releasable' ? ringTint(hold.tier, level) : color.textFaint;
  const amount = token ? formatUnits(BigInt(hold.amount), token.decimals) : '…';
  const symbol = token?.symbol ?? '';
  const recipientName = shortAddress(hold.recipient);
  const evidence = receipt.document?.evidence ?? [];
  const spoken = receipt.spoken[lang] ?? receipt.spoken.en ?? null;
  const noteUrl =
    receipt.voiceNoteUrl ??
    (hasAgent && hold.evidenceHash && shouldAutoPlayVoiceNote(hold.tier)
      ? guardian.voiceNoteUrl(hold.evidenceHash, lang)
      : null);

  const run = async (what: Exclude<Working, null>, task: () => Promise<unknown>, done: string) => {
    setConfirming(null);
    setFailure(null);
    setWorking(what);
    try {
      await task();
      haptic.success();
      if (what === 'undo') playSound('returned');
      else if (what === 'release') playSound('released');
      toast(done, 'calm');
      await query.refetch();
    } catch (error) {
      const message = describeFailure(error, t, 'hold');
      setFailure(message);
      if (!message.cancelled) haptic.error();
    } finally {
      setWorking(null);
    }
  };

  return (
    <Screen
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      footer={
        isSender && phase === 'undoable' ? (
          <>
            <Button
              label={working === 'undo' ? t('hold.undoing') : t('hold.undo')}
              variant="danger"
              icon="corner-up-left"
              loading={working === 'undo'}
              disabled={working !== null}
              onPress={() => setConfirming('undo')}
            />
            {isWalletUser ? (
              <Button
                label={working === 'release' ? t('hold.releasing') : t('hold.releaseNow')}
                variant="secondary"
                compact
                loading={working === 'release'}
                disabled={working !== null}
                onPress={() => setConfirming('release')}
              />
            ) : null}
          </>
        ) : phase === 'releasable' && isWalletUser ? (
          <Button
            label={working === 'release' ? t('hold.releasing') : t('hold.claim')}
            icon="send"
            loading={working === 'release'}
            disabled={working !== null}
            accessibilityHint={t('hold.claimHint')}
            onPress={() =>
              void run('release', () => actions.release(hold, false), t('hold.releasedDone'))
            }
          />
        ) : undefined
      }
    >
      <Header
        title={t('hold.title')}
        right={
          <IconButton
            icon="external-link"
            label={t('hold.explorer')}
            onPress={() => void WebBrowser.openBrowserAsync(explorerUrl('address', hold.pda))}
          />
        }
      />

      <Animated.View entering={FadeIn.duration(400)} style={styles.ringWrap}>
        <CountdownRing
          size={264}
          strokeWidth={14}
          createdAt={hold.createdAt}
          releaseAt={hold.releaseAt}
          tint={tint}
          running={phase === 'undoable'}
          frozenAt={phase === 'released' ? 1 : 0}
          ticks
          syncKey={Math.floor(now / 30_000)}
        >
          {phase === 'undoable' ? (
            <View
              style={styles.ringCenter}
              accessible
              accessibilityRole="timer"
              accessibilityLabel={`${formatClock(remaining)} ${isSender ? t('hold.leftToUndo') : t('hold.leftToArrive')}`}
            >
              <Text variant="clock" tone={tint}>
                {formatClock(remaining)}
              </Text>
              <Text variant="caption" tone="muted">
                {isSender ? t('hold.leftToUndo') : t('hold.leftToArrive')}
              </Text>
            </View>
          ) : (
            <View style={styles.ringCenter}>
              <Icon
                name={
                  phase === 'reclaimed'
                    ? 'corner-up-left'
                    : phase === 'released'
                      ? 'check'
                      : 'clock'
                }
                size={40}
                tint={phase === 'releasable' ? tint : color.textMuted}
              />
              <Text variant="bodyStrong" tone="muted" align="center">
                {phase === 'releasable'
                  ? t('hold.readyToRelease')
                  : phase === 'released'
                    ? t('hold.released', { name: recipientName })
                    : t('hold.reclaimed')}
              </Text>
            </View>
          )}
        </CountdownRing>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(300)} style={styles.summary}>
        <Text variant="amount" align="center">
          {amount}
          <Text variant="heading" tone="muted">{`  ${symbol}`}</Text>
        </Text>
        <View style={styles.centerRow}>
          <TierBadge tier={hold.tier} />
        </View>
        {isSender ? (
          <Text variant="small" tone="muted" align="center">
            {t(`tierHint.${hold.tier}`)}
          </Text>
        ) : null}
      </Animated.View>

      <Card style={styles.parties}>
        <Party label={t('hold.sentFrom')} address={hold.sender} />
        <Icon name="arrow-right" size={18} tint={color.textFaint} />
        <Party label={t('hold.sentTo')} address={hold.recipient} />
      </Card>

      {hold.origin === 'DEPOSIT_BOX' ? (
        <Notice
          tone="neutral"
          icon="corner-up-left"
          body={`${t('hold.origin')}. ${t('pollar.note')}`}
        />
      ) : null}
      {isSender && phase === 'undoable' && !isWalletUser ? (
        <Text variant="caption" tone="faint" align="center">
          {t('hold.releasePollar')}
        </Text>
      ) : null}
      {failure ? <Notice tone={failure.tone} body={failure.text} /> : null}

      {noteUrl ? (
        <VoiceNote url={noteUrl} autoPlay={isSender && shouldAutoPlayVoiceNote(hold.tier)} />
      ) : null}

      {isSender && hold.status === 'PENDING' && hasAgent ? (
        <Button
          label={t('hold.talk')}
          variant="secondary"
          icon="mic"
          onPress={() => setCalling(true)}
        />
      ) : null}

      <Section title={t('hold.evidenceTitle')}>
        <Card style={styles.evidence}>
          {spoken ? <Text variant="small">{spoken}</Text> : null}
          {evidence.length > 0 ? (
            <EvidenceList items={evidence} />
          ) : (
            <Text variant="small" tone="muted">
              {receipt.document ? t('send.noFindings') : t('hold.noEvidence')}
            </Text>
          )}
          {hold.evidenceHash ? (
            <View style={styles.hash}>
              <Text variant="caption" tone="faint">
                {t('hold.evidenceHash')}
              </Text>
              <Text variant="monoSmall" tone="muted" selectable>
                {hold.evidenceHash}
              </Text>
            </View>
          ) : null}
        </Card>
      </Section>

      {isSender && alreadyReported ? (
        <Text variant="caption" tone="faint" align="center">
          {t('hold.alreadyReported')}
        </Text>
      ) : isSender ? (
        isWalletUser ? (
          <Button
            label={t('hold.report')}
            variant="ghost"
            icon="flag"
            loading={working === 'report'}
            disabled={working !== null}
            onPress={() => setConfirming('report')}
          />
        ) : (
          <Text variant="caption" tone="faint" align="center">
            {t('hold.reportPollar')}
          </Text>
        )
      ) : null}

      <Sheet
        visible={confirming === 'undo'}
        onClose={() => setConfirming(null)}
        title={t('hold.undoConfirmTitle')}
      >
        <Text variant="body" tone="muted">
          {t('hold.undoConfirmBody', { amount, symbol, name: recipientName })}
        </Text>
        <Button
          label={t('hold.undo')}
          variant="danger"
          icon="corner-up-left"
          onPress={() => void run('undo', () => actions.undo(hold), t('hold.undone'))}
        />
        <Button label={t('common.cancel')} variant="ghost" onPress={() => setConfirming(null)} />
      </Sheet>

      <Sheet
        visible={confirming === 'release'}
        onClose={() => setConfirming(null)}
        title={t('hold.releaseConfirmTitle')}
      >
        <Text variant="body" tone="muted">
          {t('hold.releaseConfirmBody', { amount, symbol, name: recipientName })}
        </Text>
        <Button
          label={t('hold.releaseNow')}
          onPress={() =>
            void run('release', () => actions.release(hold, true), t('hold.releasedDone'))
          }
        />
        <Button label={t('common.cancel')} variant="ghost" onPress={() => setConfirming(null)} />
      </Sheet>

      <Sheet
        visible={confirming === 'report'}
        onClose={() => setConfirming(null)}
        title={t('hold.reportTitle')}
      >
        <Text variant="small" tone="muted">
          {t('hold.reportBody')}
        </Text>
        <View style={styles.reasons} accessibilityRole="radiogroup">
          {REASONS.map((name) => (
            <Chip
              key={name}
              label={t(`reason.${name}`)}
              selected={name === reason}
              tint={color.amber}
              onPress={() => setReason(name)}
            />
          ))}
        </View>
        <Button
          label={t('hold.reportSubmit')}
          variant="danger"
          icon="flag"
          onPress={() =>
            void run(
              'report',
              () => actions.report(new PublicKey(hold.recipient), FlagReason[reason]),
              t('hold.reported'),
            )
          }
        />
      </Sheet>

      {token ? (
        <GuardianCall
          visible={calling}
          onClose={() => setCalling(false)}
          receipt={receipt}
          token={token}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: space.huge },
  ringWrap: { alignItems: 'center', paddingVertical: space.md },
  ringCenter: { alignItems: 'center', gap: space.xs, paddingHorizontal: space.xxl },
  summary: { gap: space.sm },
  centerRow: { alignItems: 'center' },
  parties: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  party: {
    minHeight: touch.min,
    justifyContent: 'center',
    gap: space.xxs,
    borderRadius: radius.sm,
  },
  evidence: { gap: space.md },
  hash: { gap: space.xxs },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
