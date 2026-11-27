import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useHolds } from '@/data/holds';
import { useHoldsRealtime } from '@/data/realtime';
import { HoldRow } from '@/features/HoldRow';
import { ReconnectCard } from '@/features/ReconnectCard';
import { sortForDisplay } from '@/lib/holds';
import { useT } from '@/state/settings';
import { space } from '@/theme/tokens';
import { Card } from '@/ui/Card';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { EmptyState, Section } from '@/ui/Section';
import { Text } from '@/ui/Text';
import { useWallet } from '@/wallet/WalletContext';

/**
 * The recipient's view: payments on their way, each with the time it
 * arrives. Delivery needs no action; the crank releases a hold when its
 * window ends, and a wallet user can also trigger it from the hold itself.
 */
export default function Inbox() {
  const t = useT();
  const router = useRouter();
  const { address } = useWallet();
  const live = useHoldsRealtime();
  const received = useHolds('recipient', live);
  const records = useMemo(() => sortForDisplay(received.data?.records ?? []), [received.data]);
  const pending = records.filter((record) => record.status === 'PENDING');
  const settled = records.filter((record) => record.status !== 'PENDING');

  if (!address) {
    return (
      <Screen tabBarInset>
        <ReconnectCard />
      </Screen>
    );
  }

  return (
    <Screen
      tabBarInset
      onRefresh={() => void received.refetch()}
      refreshing={received.isRefetching}
    >
      <View style={styles.head}>
        <Text variant="title" accessibilityRole="header">
          {t('inbox.title')}
        </Text>
        <Text variant="small" tone="muted">
          {t('inbox.subtitle')}
        </Text>
      </View>

      {received.data?.source === 'chain' ? (
        <Notice tone="neutral" body={t('home.fromChain')} />
      ) : null}

      {pending.length === 0 ? (
        <Card>
          <EmptyState icon="inbox" title={t('inbox.emptyTitle')} body={t('inbox.emptyBody')} />
        </Card>
      ) : (
        <>
          <View style={styles.list}>
            {pending.map((record, index) => (
              <HoldRow
                key={record.pda}
                record={record}
                perspective="recipient"
                index={index}
                onPress={() => router.push(`/hold/${record.pda}`)}
              />
            ))}
          </View>
          <Text variant="caption" tone="faint" align="center">
            {t('inbox.autoDeliver')}
          </Text>
        </>
      )}

      {settled.length > 0 ? (
        <Section title={t('home.historyTitle')}>
          <View style={styles.list}>
            {settled.map((record, index) => (
              <HoldRow
                key={record.pda}
                record={record}
                perspective="recipient"
                index={index}
                onPress={() => router.push(`/hold/${record.pda}`)}
              />
            ))}
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.xs },
  list: { gap: space.sm },
});
