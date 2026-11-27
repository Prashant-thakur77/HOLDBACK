import type { HoldRecord } from '@holdback/sdk';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { useTokenMeta } from '@/data/tokens';
import { shortAddress } from '@/lib/address';
import { formatUnits } from '@/lib/amount';
import { formatClock, remainingSecs, totalWindowSecs, urgency } from '@/lib/countdown';
import { holdPhase } from '@/lib/holds';
import { useNow } from '@/state/clock';
import { useT } from '@/state/settings';
import { color, ringTint, space } from '@/theme/tokens';
import { Card } from '@/ui/Card';
import { CountdownRing } from '@/ui/CountdownRing';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { TierBadge } from '@/ui/TierBadge';

export interface HoldRowProps {
  record: HoldRecord;
  /** Which side of the hold the viewer is on: decides whose address is shown. */
  perspective: 'sender' | 'recipient';
  onPress: () => void;
  index?: number;
}

/** One hold in a list: its ring, who it is with, how much, and how long is left. */
export function HoldRow({ record, perspective, onPress, index = 0 }: HoldRowProps) {
  const t = useT();
  const now = useNow();
  const token = useTokenMeta(record.mint);
  const phase = holdPhase(record, now);
  const remaining = remainingSecs(record.releaseAt, now);
  const level = urgency(remaining, totalWindowSecs(record.createdAt, record.releaseAt));
  const pending = phase === 'undoable';
  const tint = pending ? ringTint(record.tier, level) : color.textFaint;

  const other = shortAddress(perspective === 'sender' ? record.recipient : record.sender);
  const who =
    perspective === 'sender' ? t('home.to', { name: other }) : t('home.from', { name: other });
  const amount = token
    ? `${formatUnits(BigInt(record.amount), token.decimals, 4)} ${token.symbol}`
    : '…';
  const stateText =
    phase === 'undoable'
      ? formatClock(remaining)
      : phase === 'releasable'
        ? t('hold.readyToRelease')
        : t(`status.${record.status}`);

  return (
    <Animated.View entering={FadeInDown.delay(index * 40).duration(260)} layout={LinearTransition}>
      <Card
        onPress={onPress}
        accessibilityLabel={`${who}, ${amount}, ${t(`tier.${record.tier}`)}, ${stateText}`}
        style={styles.card}
      >
        <CountdownRing
          size={52}
          strokeWidth={5}
          createdAt={record.createdAt}
          releaseAt={record.releaseAt}
          tint={tint}
          running={pending}
          frozenAt={phase === 'released' ? 1 : 0}
          syncKey={Math.floor(now / 60_000)}
        >
          <Icon
            name={
              phase === 'reclaimed'
                ? 'corner-up-left'
                : phase === 'released'
                  ? 'check'
                  : perspective === 'sender'
                    ? 'arrow-up-right'
                    : 'arrow-down-left'
            }
            size={18}
            tint={tint}
          />
        </CountdownRing>
        <View style={styles.middle}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {who}
          </Text>
          <TierBadge tier={record.tier} />
        </View>
        <View style={styles.right}>
          <Text variant="mono" numberOfLines={1}>
            {amount}
          </Text>
          <Text variant="monoSmall" tone={pending ? tint : 'muted'} numberOfLines={1}>
            {stateText}
          </Text>
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  middle: { flex: 1, gap: space.xs },
  right: { alignItems: 'flex-end', gap: space.xxs },
});
