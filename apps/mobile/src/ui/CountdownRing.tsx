import { useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';

import { remainingFraction, toMs } from '@/lib/countdown';
import { color } from '@/theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface CountdownRingProps {
  size: number;
  strokeWidth: number;
  /** Start and end of the undo window (ISO strings or unix seconds). */
  createdAt: string | number;
  releaseAt: string | number;
  /** Colour of the remaining arc. */
  tint: string;
  /**
   * `false` freezes the ring: full for a released hold, empty for a returned
   * one (pass `frozenAt`). Running rings drain on the UI thread.
   */
  running?: boolean;
  frozenAt?: number;
  /** Minute marks around the dial, for the large ring. */
  ticks?: boolean;
  /** Changing this re-reads the clock (used to stay honest after the app was in the background). */
  syncKey?: number;
  children?: ReactNode;
}

const SWEEP_IN_MS = 700;

/**
 * The undo window as a ring that drains. The arc is driven by one linear
 * animation that ends exactly at the release time, so it stays smooth without
 * a JavaScript timer and cannot drift from the real deadline.
 */
export function CountdownRing({
  size,
  strokeWidth,
  createdAt,
  releaseAt,
  tint,
  running = true,
  frozenAt = 0,
  ticks = false,
  syncKey = 0,
  children,
}: CountdownRingProps) {
  const reducedMotion = useReducedMotion();
  const center = size / 2;
  const inset = ticks ? strokeWidth * 2.2 : 0;
  const r = center - strokeWidth / 2 - inset;
  const circumference = 2 * Math.PI * r;
  const fraction = useSharedValue(running ? 1 : frozenAt);

  useEffect(() => {
    cancelAnimation(fraction);
    if (!running) {
      fraction.set(withTiming(frozenAt, { duration: reducedMotion ? 0 : SWEEP_IN_MS }));
      return;
    }
    const now = Date.now();
    const remainingMs = Math.max(0, toMs(releaseAt) - now);
    const sweep = reducedMotion ? 0 : Math.min(SWEEP_IN_MS, remainingMs);
    // Sweep to where the ring will be when the sweep ends, then drain to the deadline.
    const afterSweep = remainingFraction(createdAt, releaseAt, now + sweep);
    fraction.set(
      withSequence(
        withTiming(afterSweep, { duration: sweep, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: remainingMs - sweep, easing: Easing.linear }),
      ),
    );
    return () => cancelAnimation(fraction);
  }, [createdAt, releaseAt, running, frozenAt, syncKey, reducedMotion, fraction]);

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - fraction.get()),
  }));

  // The bright dot at the end of the arc: the "hand" of the dial.
  const headProps = useAnimatedProps(() => {
    const angle = 2 * Math.PI * fraction.get() - Math.PI / 2;
    return {
      cx: center + r * Math.cos(angle),
      cy: center + r * Math.sin(angle),
      opacity: fraction.get() > 0.002 && fraction.get() < 0.998 ? 1 : 0,
    };
  });

  const tickMarks = useMemo(() => {
    if (!ticks) return null;
    const outer = center - 1;
    return Array.from({ length: 60 }, (_, i) => {
      const major = i % 5 === 0;
      const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
      const inner = outer - (major ? strokeWidth * 0.9 : strokeWidth * 0.45);
      return (
        <Line
          key={i}
          x1={center + inner * Math.cos(angle)}
          y1={center + inner * Math.sin(angle)}
          x2={center + outer * Math.cos(angle)}
          y2={center + outer * Math.sin(angle)}
          stroke={major ? color.hairlineStrong : color.hairline}
          strokeWidth={major ? 2 : 1}
          strokeLinecap="round"
        />
      );
    });
  }, [ticks, center, strokeWidth]);

  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <Svg width={size} height={size}>
        {tickMarks}
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={color.raised}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={center}
          cy={center}
          r={r}
          stroke={tint}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={arcProps}
          transform={`rotate(-90 ${center} ${center})`}
        />
        {running && strokeWidth >= 8 ? (
          <AnimatedCircle r={strokeWidth * 0.28} fill={color.ink} animatedProps={headProps} />
        ) : null}
      </Svg>
      {children ? <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
