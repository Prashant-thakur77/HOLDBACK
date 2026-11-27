import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
} from '@expo-google-fonts/bricolage-grotesque';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppEffects } from '@/features/AppEffects';
import { useSettings } from '@/state/settings';
import { color } from '@/theme/tokens';
import { ToastHost } from '@/ui/Toast';
import { WalletProvider } from '@/wallet/WalletProvider';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export default function RootLayout() {
  const [fontsReady] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });
  const hydrated = useSettings((state) => state.hydrated);
  const onboarded = useSettings((state) => state.onboarded);
  const ready = fontsReady && hydrated;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.ink }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <WalletProvider>
            <AppEffects />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: color.ink },
                animation: 'fade_from_bottom',
              }}
            >
              <Stack.Protected guard={onboarded}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="send" options={{ animation: 'slide_from_bottom' }} />
                <Stack.Screen name="hold/[pda]" />
                <Stack.Screen name="trusted" />
              </Stack.Protected>
              <Stack.Protected guard={!onboarded}>
                <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
              </Stack.Protected>
              <Stack.Screen name="auth" />
            </Stack>
            <ToastHost />
            <StatusBar style="light" />
          </WalletProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
