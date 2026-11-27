import { Tabs } from 'expo-router/js-tabs';

import { color } from '@/theme/tokens';
import { TabBar } from '@/ui/TabBar';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.ink } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="dojo" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
