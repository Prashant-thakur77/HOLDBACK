import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { color, motion, radius, space, touch } from '@/theme/tokens';

import { haptic } from './haptics';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'danger' | 'secondary' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Smaller height for secondary rows; still at least the minimum touch target. */
  compact?: boolean;
  accessibilityHint?: string;
  trailing?: ReactNode;
}

const FILL: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: color.lume, fg: color.onBright, border: color.lume },
  danger: { bg: color.red, fg: color.onBright, border: color.red },
  secondary: { bg: color.raised, fg: color.text, border: color.hairlineStrong },
  ghost: { bg: color.transparent, fg: color.text, border: color.transparent },
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  compact = false,
  accessibilityHint,
  trailing,
}: ButtonProps) {
  const pressed = useSharedValue(0);
  const fill = FILL[variant];
  const inactive = disabled || loading;

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.get() * 0.03 }],
    opacity: 1 - pressed.get() * 0.12,
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPressIn={() => pressed.set(withTiming(1, { duration: motion.quick }))}
      onPressOut={() => pressed.set(withTiming(0, { duration: motion.quick }))}
      onPress={() => {
        if (variant === 'ghost' || variant === 'secondary') haptic.tap();
        else haptic.press();
        onPress();
      }}
      style={[
        styles.base,
        {
          backgroundColor: fill.bg,
          borderColor: fill.border,
          minHeight: compact ? touch.min : touch.comfortable,
        },
        inactive && styles.inactive,
        animated,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fill.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={18} tint={fill.fg} /> : null}
          <Text variant="bodyStrong" tone={fill.fg} align="center" style={styles.label}>
            {label}
          </Text>
          {trailing}
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactive: { opacity: 0.45 },
  content: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { flexShrink: 1 },
});
