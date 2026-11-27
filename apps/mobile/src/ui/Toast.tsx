import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import type { Tone } from '@/lib/evidence';
import { color, radius, space, toneColor } from '@/theme/tokens';

import { Text } from './Text';

interface ToastState {
  message: string | null;
  tone: Tone;
  id: number;
  show(message: string, tone?: Tone): void;
  hide(): void;
}

const useToast = create<ToastState>((set) => ({
  message: null,
  tone: 'neutral',
  id: 0,
  show: (message, tone = 'neutral') => set((state) => ({ message, tone, id: state.id + 1 })),
  hide: () => set({ message: null }),
}));

/** Shows a short message at the top of the screen. Callable from anywhere. */
export function toast(message: string, tone: Tone = 'neutral'): void {
  useToast.getState().show(message, tone);
}

const VISIBLE_MS = 3_600;

/** Mounted once at the root. */
export function ToastHost() {
  const { message, tone, id, hide } = useToast();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(hide, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message, id, hide]);

  if (!message) return null;
  return (
    <Animated.View
      key={id}
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(180)}
      style={[styles.toast, { top: insets.top + space.sm, borderColor: toneColor[tone].fg }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      pointerEvents="none"
    >
      <Text variant="smallStrong">{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: color.overlay,
    zIndex: 10,
    elevation: 10,
  },
});
