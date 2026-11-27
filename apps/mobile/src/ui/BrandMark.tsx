import Svg, { Circle, Path } from 'react-native-svg';

import { color } from '@/theme/tokens';

/**
 * The HOLDBACK mark: a ring with a quarter already drained and an arrow head
 * pointing back at its 12 o'clock end, the way an undo arrow does. Drawn in code so it stays sharp at any size
 * and matches the countdown ring it stands for.
 */
export function BrandMark({ size = 48, tint = color.lume }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96" accessibilityLabel="HOLDBACK">
      <Circle cx={48} cy={48} r={34} stroke={color.raised} strokeWidth={10} fill="none" />
      <Path
        d="M48 14 A34 34 0 1 1 14 48"
        stroke={tint}
        strokeWidth={10}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M54 1 L39 14 L54 27"
        stroke={tint}
        strokeWidth={10}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
