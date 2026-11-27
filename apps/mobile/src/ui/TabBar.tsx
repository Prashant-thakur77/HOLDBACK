import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MessageKey } from '@/i18n/types';
import { useT } from '@/state/settings';
import { color, motion, radius, space, touch } from '@/theme/tokens';

import { haptic } from './haptics';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

const TABS: Record<string, { icon: IconName; label: MessageKey }> = {
  index: { icon: 'home', label: 'tabs.home' },
  inbox: { icon: 'inbox', label: 'tabs.inbox' },
  dojo: { icon: 'shield', label: 'tabs.dojo' },
  settings: { icon: 'sliders', label: 'tabs.settings' },
};

function TabButton({
  icon,
  label,
  focused,
  onPress,
}: {
  icon: IconName;
  label: string;
  focused: boolean;
  onPress: () => void;
}) {
  const dot = useAnimatedStyle(() => ({
    opacity: withTiming(focused ? 1 : 0, { duration: motion.quick }),
    transform: [{ scaleX: withTiming(focused ? 1 : 0.2, { duration: motion.base }) }],
  }));
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.tab}
    >
      <Icon name={icon} size={22} tint={focused ? color.lume : color.textMuted} />
      <Text variant="caption" tone={focused ? color.lume : 'muted'} numberOfLines={1}>
        {label}
      </Text>
      <Animated.View style={[styles.dot, dot]} />
    </Pressable>
  );
}

/**
 * A floating tab bar with Send in the middle: sending is the app's main
 * action, so it gets the one bright button instead of a fifth equal tab.
 */
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const routes = state.routes.filter((route) => TABS[route.name]);
  const half = Math.ceil(routes.length / 2);

  const renderTab = (route: (typeof routes)[number]) => {
    const tab = TABS[route.name]!;
    const focused = state.routes[state.index]?.key === route.key;
    return (
      <TabButton
        key={route.key}
        icon={tab.icon}
        label={t(tab.label)}
        focused={focused}
        onPress={() => {
          haptic.tap();
          navigateToTab(route.key);
        }}
      />
    );
  };

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + space.md }]} pointerEvents="box-none">
      <View style={styles.bar} accessibilityRole="tablist">
        {routes.slice(0, half).map(renderTab)}
        <View style={styles.sendSlot} />
        {routes.slice(half).map(renderTab)}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tabs.send')}
        onPress={() => {
          haptic.press();
          router.push('/send');
        }}
        style={({ pressed }) => [styles.send, pressed && styles.sendPressed]}
      >
        <Icon name="arrow-up-right" size={28} tint={color.onBright} />
      </Pressable>
    </View>
  );
}

const SEND_SIZE = 68;

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.overlay,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.sm,
    height: 72,
    alignSelf: 'stretch',
    elevation: 12,
  },
  tab: {
    flex: 1,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
  },
  dot: { width: 16, height: 3, borderRadius: radius.pill, backgroundColor: color.lume },
  sendSlot: { width: SEND_SIZE + space.sm },
  send: {
    position: 'absolute',
    top: -14,
    width: SEND_SIZE,
    height: SEND_SIZE,
    borderRadius: SEND_SIZE / 2,
    backgroundColor: color.lume,
    borderWidth: 5,
    borderColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 14,
  },
  sendPressed: { transform: [{ scale: 0.95 }] },
});
