import * as Haptics from 'expo-haptics';

/** Haptics are a nicety: a device without a vibrator must never break a flow. */
const safe = (run: () => Promise<void>) => {
  run().catch(() => undefined);
};

export const haptic = {
  /** A light tick for selection changes. */
  tap: () => safe(() => Haptics.selectionAsync()),
  /** A firmer press for primary actions. */
  press: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
