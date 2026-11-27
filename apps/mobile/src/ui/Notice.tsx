import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { Tone } from '@/lib/evidence';
import { radius, space, toneColor } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

const DEFAULT_ICON: Record<Tone, IconName> = {
  calm: 'check-circle',
  neutral: 'info',
  caution: 'alert-circle',
  alert: 'alert-triangle',
  danger: 'alert-octagon',
};

/** An inline message. Announced by screen readers when it appears. */
export function Notice({
  tone = 'neutral',
  title,
  body,
  icon,
  children,
}: {
  tone?: Tone;
  title?: string;
  body?: string;
  icon?: IconName;
  children?: ReactNode;
}) {
  const { fg, bg } = toneColor[tone];
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={[styles.notice, { backgroundColor: bg }]}
      accessibilityRole={tone === 'danger' || tone === 'alert' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
    >
      <Icon name={icon ?? DEFAULT_ICON[tone]} size={18} tint={fg} />
      <View style={styles.text}>
        {title ? (
          <Text variant="smallStrong" tone={fg}>
            {title}
          </Text>
        ) : null}
        {body ? <Text variant="small">{body}</Text> : null}
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    alignItems: 'flex-start',
  },
  text: { flex: 1, gap: space.xs },
});
