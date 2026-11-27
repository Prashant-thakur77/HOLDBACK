import type { AssessResponse } from '@holdback/sdk';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { EvidenceList } from '@/features/EvidenceList';
import { formatWindow } from '@/i18n/translate';
import { topEvidence } from '@/lib/evidence';
import { useT } from '@/state/settings';
import { color, radius, space, tierColor } from '@/theme/tokens';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { TierBadge } from '@/ui/TierBadge';

export type VerdictState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; assessment: AssessResponse };

/**
 * Guardian's verdict while the user is still filling in the form: the tier,
 * the window it implies, and the three pieces of evidence that weighed most,
 * each with its source.
 */
export function VerdictCard({ state }: { state: VerdictState }) {
  const t = useT();
  if (state.status === 'idle') return null;

  if (state.status === 'loading') {
    return (
      <Card style={styles.row}>
        <ActivityIndicator color={color.lume} />
        <Text variant="small" tone="muted">
          {t('send.assessing')}
        </Text>
      </Card>
    );
  }

  if (state.status === 'failed') {
    return (
      <Card style={styles.row}>
        <Icon name="cloud-off" size={18} tint={color.textMuted} />
        <Text variant="small" tone="muted" style={styles.flex}>
          {t('send.assessFailed')}
        </Text>
      </Card>
    );
  }

  const { assessment } = state;
  const { fg, bg } = tierColor(assessment.tier);
  const evidence = topEvidence(assessment.evidence, 3);

  return (
    <Animated.View entering={FadeIn.duration(260)} layout={LinearTransition}>
      <Card accent={fg} style={styles.card}>
        <View style={styles.head}>
          <Text variant="overline" tone="muted">
            {t('send.verdictTitle')}
          </Text>
          <Text variant="monoSmall" tone="faint">
            {t('send.score', { score: assessment.score })}
          </Text>
        </View>
        <View style={styles.head}>
          <TierBadge tier={assessment.tier} />
          <View style={[styles.windowChip, { backgroundColor: bg }]}>
            <Icon name="clock" size={14} tint={fg} />
            <Text variant="caption" tone={fg}>
              {formatWindow(assessment.windowSecs, t)}
            </Text>
          </View>
        </View>
        <Text variant="small">{assessment.spoken.text || t(`tierHint.${assessment.tier}`)}</Text>
        {evidence.length > 0 ? (
          <EvidenceList items={evidence} />
        ) : (
          <Text variant="small" tone="muted">
            {t('send.noFindings')}
          </Text>
        )}
        {assessment.unavailable.length > 0 ? (
          <Text variant="caption" tone="faint">
            {t('send.unavailableSources', {
              sources: assessment.unavailable.map((source) => source.replace(/_/g, ' ')).join(', '),
            })}
          </Text>
        ) : null}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  windowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
});
