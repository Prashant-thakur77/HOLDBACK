import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useT } from '@/state/settings';
import { color, radius, space, touch } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** A round icon button, sized to the minimum touch target. */
export function IconButton({
  icon,
  label,
  onPress,
  tint = color.text,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Icon name={icon} size={20} tint={tint} />
    </Pressable>
  );
}

/** Title row for pushed screens: back button, title, optional action. */
export function Header({ title, right }: { title: string; right?: ReactNode }) {
  const router = useRouter();
  const t = useT();
  return (
    <View style={styles.header}>
      <IconButton
        icon="arrow-left"
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Text variant="heading" style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { flex: 1 },
  right: { minWidth: touch.min, alignItems: 'flex-end' },
  iconButton: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.pill,
    backgroundColor: color.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: color.overlay },
});
