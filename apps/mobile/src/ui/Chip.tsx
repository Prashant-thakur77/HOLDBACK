import { Pressable, StyleSheet } from 'react-native';

import { color, radius, space, touch } from '@/theme/tokens';

import { haptic } from './haptics';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** Colour of the selected state. Defaults to the brand lume. */
  tint?: string;
  disabled?: boolean;
}

/** A choice in a row of choices (window lengths, languages, tokens). */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  tint = color.lume,
  disabled,
}: ChipProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled || !onPress}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={[
        styles.chip,
        selected && { backgroundColor: tint, borderColor: tint },
        disabled && styles.disabled,
      ]}
    >
      {icon ? (
        <Icon name={icon} size={16} tint={selected ? color.onBright : color.textMuted} />
      ) : null}
      <Text variant="smallStrong" tone={selected ? 'onBright' : 'default'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: touch.min,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    backgroundColor: color.raised,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  disabled: { opacity: 0.4 },
});
