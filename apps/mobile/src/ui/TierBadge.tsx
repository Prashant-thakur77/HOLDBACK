import type { TierName } from '@holdback/sdk';
import { StyleSheet, View } from 'react-native';

import { useT } from '@/state/settings';
import { radius, space, tierColor } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

const ICON: Record<TierName, IconName> = {
  TRUSTED: 'check-circle',
  UNKNOWN: 'help-circle',
  SUSPICIOUS: 'alert-circle',
  FLAGGED: 'alert-triangle',
  SANCTIONED: 'slash',
};

/** The risk tier as a pill. The icon differs per tier so colour is never the only signal. */
export function TierBadge({ tier }: { tier: TierName }) {
  const t = useT();
  const { fg, bg } = tierColor(tier);
  return (
    <View style={[styles.badge, { backgroundColor: bg }]} accessibilityLabel={t(`tier.${tier}`)}>
      <Icon name={ICON[tier]} size={14} tint={fg} />
      <Text variant="caption" tone={fg}>
        {t(`tier.${tier}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
});
