import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, space } from '@/theme/tokens';

export interface ScreenProps {
  children: ReactNode;
  /** Scrolls by default; pass `false` for screens that manage their own layout. */
  scroll?: boolean;
  /** Pinned below the scrolling content (primary actions). */
  footer?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Extra bottom padding so content clears the floating tab bar. */
  tabBarInset?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

export const TAB_BAR_CLEARANCE = 104;

/** Page frame: background, safe areas, gutters, keyboard avoidance. */
export function Screen({
  children,
  scroll = true,
  footer,
  onRefresh,
  refreshing = false,
  tabBarInset = false,
  contentStyle,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + space.md,
    paddingBottom:
      (footer ? space.lg : insets.bottom + space.lg) + (tabBarInset ? TAB_BAR_CLEARANCE : 0),
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      {scroll ? (
        <ScrollView
          style={styles.root}
          contentContainerStyle={[styles.content, padding, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={color.lume}
                colors={[color.lume]}
                progressBackgroundColor={color.overlay}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.root, styles.content, padding, contentStyle]}>{children}</View>
      )}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>{footer}</View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ink },
  content: { paddingHorizontal: space.xl, gap: space.lg },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    gap: space.sm,
    backgroundColor: color.ink,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
});
