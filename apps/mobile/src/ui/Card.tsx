import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, radius, space } from '@/theme/tokens';

import { haptic } from './haptics';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** A coloured edge, used to carry a hold's tier into the card. */
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, onPress, accessibilityLabel, accent, style }: CardProps) {
  const body = [styles.card, accent ? { borderColor: accent } : null, style];
  if (!onPress) return <View style={body}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [body, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
  },
  pressed: { backgroundColor: color.raised },
});
