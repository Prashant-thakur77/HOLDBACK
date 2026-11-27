import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { color, font, radius, space, touch } from '@/theme/tokens';

import { Text } from './Text';

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Shown under the field. An `error` replaces the `hint`. */
  hint?: string;
  error?: string | null;
  /** Rendered inside the field on the right (paste, scan, max…). */
  accessory?: ReactNode;
  /** Monospace digits, for amounts and addresses. */
  mono?: boolean;
  large?: boolean;
}

export function Field({
  label,
  hint,
  error,
  accessory,
  mono,
  large,
  multiline,
  ...input
}: FieldProps) {
  const note = error ?? hint;
  return (
    <View style={styles.wrap}>
      <Text variant="overline" tone="muted">
        {label}
      </Text>
      <View style={[styles.box, error ? styles.boxError : null, multiline && styles.boxMultiline]}>
        <TextInput
          {...input}
          multiline={multiline}
          accessibilityLabel={label}
          placeholderTextColor={color.textFaint}
          selectionColor={color.lume}
          cursorColor={color.lume}
          style={[
            styles.input,
            mono && { fontFamily: font.mono },
            large && styles.inputLarge,
            multiline && styles.inputMultiline,
          ]}
        />
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>
      {note ? (
        <Text variant="small" tone={error ? color.red : 'muted'} accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  box: {
    minHeight: touch.comfortable,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingLeft: space.lg,
    paddingRight: space.sm,
  },
  boxMultiline: { alignItems: 'flex-start' },
  boxError: { borderColor: color.red },
  input: {
    flex: 1,
    color: color.text,
    fontFamily: font.body,
    fontSize: 16,
    paddingVertical: space.md,
  },
  inputLarge: { fontFamily: font.monoBold, fontSize: 28 },
  inputMultiline: { minHeight: 84, textAlignVertical: 'top' },
  accessory: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
