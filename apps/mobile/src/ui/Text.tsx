import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { color, type, type TypeVariant } from '@/theme/tokens';

export interface TextProps extends NativeTextProps {
  variant?: TypeVariant;
  /** A named text colour or any colour value. */
  tone?: 'default' | 'muted' | 'faint' | 'onBright' | (string & {});
  align?: 'left' | 'center' | 'right';
}

const NAMED: Record<string, string> = {
  default: color.text,
  muted: color.textMuted,
  faint: color.textFaint,
  onBright: color.onBright,
};

/** All text in the app goes through this, so the type ramp is applied in one place. */
export function Text({ variant = 'body', tone = 'default', align, style, ...rest }: TextProps) {
  return (
    <NativeText
      {...rest}
      style={[type[variant], { color: NAMED[tone] ?? tone, textAlign: align }, style]}
    />
  );
}
