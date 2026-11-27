import type { HoldRecord } from '@holdback/sdk';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useBalances, useSeeker } from '@/data/chain';
import { POLL_INTERVAL_MS, useHolds } from '@/data/holds';
import { useHoldsRealtime } from '@/data/realtime';
import { usePaymentToken, USDC_MINT } from '@/data/tokens';
import { HoldRow } from '@/features/HoldRow';
import { describeFailure } from '@/features/messages';
import { ReconnectCard } from '@/features/ReconnectCard';
import { shortAddress } from '@/lib/address';
import { formatUnits } from '@/lib/amount';
import { sortForDisplay } from '@/lib/holds';
import { useT } from '@/state/settings';
import { color, radius, space, touch } from '@/theme/tokens';
import { BrandMark } from '@/ui/BrandMark';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { haptic } from '@/ui/haptics';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { EmptyState, Section } from '@/ui/Section';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';
import { useWallet } from '@/wallet/WalletContext';

const HISTORY_LIMIT = 8;
const INCOMING_PREVIEW = 3;

/** "Live" with a breathing dot when Realtime is connected, otherwise the polling interval. */
function LiveIndicator({ live }: { live: boolean }) {
  const t = useT();
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(live ? withRepeat(withTiming(0.3, { duration: 900 }), -1, true) : 1);
  }, [live, pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <View style={styles.live}>
      <Animated.View
        style={[styles.liveDot, { backgroundColor: live ? color.lume : color.textFaint }, dot]}
      />
      <Text variant="caption" tone={live ? color.lume : 'faint'}>
        {live ? t('home.live') : t('home.polling', { seconds: POLL_INTERVAL_MS / 1000 })}
      </Text>
    </View>
  );
}

function sumPending(records: readonly HoldRecord[], mint: string): bigint {
  return records
    .filter((record) => record.status === 'PENDING' && record.mint === mint)
    .reduce((total, record) => total + BigInt(record.amount), 0n);
}

export default function Home() {
  const t = useT();
  const router = useRouter();
  const { address, kind, pollar } = useWallet();
  const live = useHoldsRealtime();
  const sent = useHolds('sender', live);
  const received = useHolds('recipient', live);
  const balances = useBalances();
  const token = usePaymentToken();
  const seeker = useSeeker();
  const [withdrawing, setWithdrawing] = useState(false);

  const outgoing = useMemo(() => sortForDisplay(sent.data?.records ?? []), [sent.data]);
  const active = outgoing.filter((record) => record.status === 'PENDING');
  const earlier = outgoing.filter((record) => record.status !== 'PENDING').slice(0, HISTORY_LIMIT);
  const incoming = useMemo(
    () =>
      sortForDisplay(received.data?.records ?? []).filter((record) => record.status === 'PENDING'),
    [received.data],
  );
  const onHold = sumPending(outgoing, USDC_MINT);
  const openHold = (pda: string) => router.push(`/hold/${pda}`);

  if (!address) {
    return (
      <Screen tabBarInset>
        <ReconnectCard />
      </Screen>
    );
  }

  const wallet = address.toBase58();
  const amountText = (value: bigint | undefined) =>
    value !== undefined && token ? formatUnits(value, token.decimals, 2) : '—';
  const box = balances.data?.box ?? null;

  const withdraw = async () => {
    if (!pollar || box === null || box === 0n) return;
    setWithdrawing(true);
    try {
      await pollar.flow.withdraw(box);
      toast(t('home.withdrawDone'), 'calm');
      await balances.refetch();
    } catch (error) {
      toast(describeFailure(error, t, 'hold').text, 'alert');
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <Screen
      tabBarInset
      refreshing={sent.isRefetching || received.isRefetching}
      onRefresh={() => {
        void sent.refetch();
        void received.refetch();
        void balances.refetch();
      }}
    >
      <View style={styles.top}>
        <BrandMark size={32} />
        <Text variant="heading" style={styles.wordmark}>
          HOLDBACK
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${wallet}. ${t('common.copy')}`}
          onPress={() => {
            haptic.tap();
            void Clipboard.setStringAsync(wallet);
            toast(t('common.copied'), 'calm');
          }}
          style={styles.walletPill}
        >
          <Icon name={kind === 'pollar' ? 'mail' : 'key'} size={14} tint={color.textMuted} />
          <Text variant="monoSmall" tone="muted">
            {seeker.data?.skrDomain ?? shortAddress(wallet)}
          </Text>
        </Pressable>
      </View>

      {seeker.data?.seekerOwner ? (
        <View style={styles.seeker}>
          <Icon name="award" size={14} tint={color.lume} />
          <Text variant="caption" tone={color.lume}>
            {t('home.seekerBadge')}
          </Text>
          {seeker.data.skrBalance ? (
            <Text variant="caption" tone="muted">
              {t('home.skrBalance', { amount: seeker.data.skrBalance })}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Card style={styles.balanceCard}>
        <View style={styles.balanceHead}>
          <Text variant="overline" tone="muted">
            {t('home.balance')}
          </Text>
          <LiveIndicator live={live} />
        </View>
        <Text
          variant="amount"
          accessibilityLabel={`${amountText(balances.data?.token)} ${token?.symbol ?? ''}`}
        >
          {amountText(balances.data?.token)}
          <Text variant="heading" tone="muted">
            {`  ${token?.symbol ?? ''}`}
          </Text>
        </Text>
        <Text variant="mono" tone="muted">
          {balances.data ? `${formatUnits(balances.data.sol, 9, 4)} SOL` : t('home.balanceUnknown')}
        </Text>

        <View style={styles.divider} />
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text variant="caption" tone="faint">
              {t('home.protectedNow')}
            </Text>
            <Text variant="mono" tone={onHold > 0n ? color.lume : 'muted'}>
              {`${amountText(onHold)} ${token?.symbol ?? ''}`}
            </Text>
          </View>
          {box !== null ? (
            <View style={styles.stat}>
              <Text variant="caption" tone="faint">
                {t('home.depositBox')}
              </Text>
              <Text variant="mono" tone="muted">
                {`${amountText(box)} ${token?.symbol ?? ''}`}
              </Text>
            </View>
          ) : null}
        </View>
        {box !== null && box > 0n ? (
          <Button
            label={t('home.withdraw')}
            variant="secondary"
            compact
            icon="corner-up-left"
            loading={withdrawing}
            onPress={() => void withdraw()}
          />
        ) : null}
      </Card>

      {sent.data?.source === 'chain' ? <Notice tone="neutral" body={t('home.fromChain')} /> : null}

      <Section title={t('home.activeTitle')}>
        {active.length === 0 ? (
          <Card>
            <EmptyState
              icon="clock"
              title={t('home.emptyTitle')}
              body={t('home.emptyBody')}
              action={
                <Button label={t('home.sendFirst')} compact onPress={() => router.push('/send')} />
              }
            />
          </Card>
        ) : (
          <View style={styles.list}>
            {active.map((record, index) => (
              <HoldRow
                key={record.pda}
                record={record}
                perspective="sender"
                index={index}
                onPress={() => openHold(record.pda)}
              />
            ))}
          </View>
        )}
      </Section>

      {incoming.length > 0 ? (
        <Section
          title={t('home.incomingTitle')}
          action={
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/inbox')}
              hitSlop={12}
              style={styles.seeAll}
            >
              <Text variant="caption" tone={color.lume}>
                {t('common.seeAll')}
              </Text>
            </Pressable>
          }
        >
          <View style={styles.list}>
            {incoming.slice(0, INCOMING_PREVIEW).map((record, index) => (
              <HoldRow
                key={record.pda}
                record={record}
                perspective="recipient"
                index={index}
                onPress={() => openHold(record.pda)}
              />
            ))}
          </View>
        </Section>
      ) : null}

      <Card onPress={() => router.push('/trusted')} style={styles.linkRow}>
        <Icon name="users" size={20} tint={color.lume} />
        <Text variant="bodyStrong" style={styles.flex}>
          {t('home.trustedPeople')}
        </Text>
        <Icon name="chevron-right" size={20} tint={color.textFaint} />
      </Card>

      {earlier.length > 0 ? (
        <Section title={t('home.historyTitle')}>
          <View style={styles.list}>
            {earlier.map((record, index) => (
              <HoldRow
                key={record.pda}
                record={record}
                perspective="sender"
                index={index}
                onPress={() => openHold(record.pda)}
              />
            ))}
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  wordmark: { flex: 1, letterSpacing: 1.5 },
  flex: { flex: 1 },
  walletPill: {
    minHeight: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.raised,
  },
  seeker: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  balanceCard: { gap: space.sm },
  balanceHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  live: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.hairline,
    marginVertical: space.sm,
  },
  statRow: { flexDirection: 'row', gap: space.xl },
  stat: { flex: 1, gap: space.xxs },
  list: { gap: space.sm },
  seeAll: { minHeight: 24, justifyContent: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
