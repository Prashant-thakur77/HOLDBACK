import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { TokenMeta } from '@/data/tokens';
import { formatUnits } from '@/lib/amount';
import { useNow } from '@/state/clock';
import { useT } from '@/state/settings';
import { color, space } from '@/theme/tokens';
import { Card } from '@/ui/Card';
import { Icon, type IconName } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Text } from '@/ui/Text';

import type { PreviewState } from './hooks';

function Line({
  icon,
  text,
  tint = color.textMuted,
}: {
  icon: IconName;
  text: string;
  tint?: string;
}) {
  return (
    <View style={styles.line}>
      <Icon name={icon} size={16} tint={tint} />
      <Text variant="small" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

/**
 * "What will happen", from a real simulation of the transaction: what leaves
 * the wallet, what the network costs, and until when it can be undone. A
 * simulation that moves more than the user typed is shown as a red warning.
 */
export function PreviewCard({
  state,
  token,
  windowSecs,
}: {
  state: PreviewState;
  token: TokenMeta;
  windowSecs: number;
}) {
  const t = useT();
  const now = useNow();
  if (state.status === 'idle') return null;

  if (state.status === 'failed') {
    return <Notice tone="alert" body={t('send.previewFailed', { reason: state.reason })} />;
  }

  const releaseTime = new Date(now + windowSecs * 1000).toLocaleString([], {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Card style={styles.card}>
      <Text variant="overline" tone="muted">
        {t('send.previewTitle')}
      </Text>
      {state.status === 'loading' ? (
        <View style={styles.line}>
          <ActivityIndicator color={color.lume} size="small" />
          <Text variant="small" tone="muted">
            {t('send.simulating')}
          </Text>
        </View>
      ) : null}
      {state.status === 'unavailable' ? (
        <Line icon="cloud-off" text={t('send.previewUnavailable')} />
      ) : null}
      {state.status === 'ok' ? (
        <>
          <Line
            icon="arrow-up-right"
            tint={color.text}
            text={t('send.previewLeaves', {
              amount: formatUnits(state.verdict.outflow, token.decimals),
              symbol: token.symbol,
            })}
          />
          <Line
            icon="zap"
            text={t('send.previewFee', { amount: formatUnits(state.verdict.costLamports, 9, 6) })}
          />
          {state.verdict.mismatch ? (
            <Notice tone="danger" body={t('send.previewMismatch')} />
          ) : null}
        </>
      ) : null}
      <Line
        icon={windowSecs === 0 ? 'fast-forward' : 'corner-up-left'}
        tint={windowSecs === 0 ? color.amber : color.lume}
        text={
          windowSecs === 0 ? t('send.previewInstant') : t('send.previewHeld', { time: releaseTime })
        }
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
});
