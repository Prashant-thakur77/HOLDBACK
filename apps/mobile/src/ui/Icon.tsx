import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';

import { color } from '@/theme/tokens';

export type IconName = ComponentProps<typeof Feather>['name'];

export function Icon({
  name,
  size = 20,
  tint = color.text,
}: {
  name: IconName;
  size?: number;
  tint?: string;
}) {
  return <Feather name={name} size={size} color={tint} />;
}
