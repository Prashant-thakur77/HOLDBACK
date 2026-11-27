import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, space } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** A titled group of content with an optional action on the right. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text variant="overline" tone="muted" accessibilityRole="header">
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** What a list shows when it has nothing in it. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={24} tint={color.textMuted} />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      <Text variant="small" tone="muted" align="center">
        {body}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  empty: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xxxl,
    paddingHorizontal: space.lg,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.raised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
});
