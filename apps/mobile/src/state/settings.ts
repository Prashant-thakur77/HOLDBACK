import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Lang } from '@holdback/sdk';
import { getLocales } from 'expo-localization';
import { useCallback } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { langFromLocale, translate, type Translate } from '@/i18n/translate';

export type WalletKind = 'mwa' | 'pollar';

interface SettingsState {
  lang: Lang;
  /** True once the onboarding flow has been completed. */
  onboarded: boolean;
  /** Which kind of wallet the user chose. `null` until onboarding. */
  walletKind: WalletKind | null;
  /** Phone number for Guardian calls, as the user entered it. Not verified by being here. */
  phone: string | null;
  /** True once the agent confirmed a texted code for `phone`. */
  phoneVerified: boolean;
  /** The user's choice; the OS permission is checked separately. */
  pushWanted: boolean;
  /** False until the stored values have been read. */
  hydrated: boolean;
  setLang(lang: Lang): void;
  setWalletKind(kind: WalletKind | null): void;
  setPhone(phone: string | null): void;
  setPhoneVerified(verified: boolean): void;
  setPushWanted(wanted: boolean): void;
  completeOnboarding(): void;
  reset(): void;
}

function deviceLang(): Lang {
  try {
    return langFromLocale(getLocales()[0]?.languageTag);
  } catch {
    return 'en';
  }
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      lang: deviceLang(),
      onboarded: false,
      walletKind: null,
      phone: null,
      phoneVerified: false,
      pushWanted: true,
      hydrated: false,
      setLang: (lang) => set({ lang }),
      setWalletKind: (walletKind) => set({ walletKind }),
      setPhone: (phone) => set({ phone, phoneVerified: false }),
      setPhoneVerified: (phoneVerified) => set({ phoneVerified }),
      setPushWanted: (pushWanted) => set({ pushWanted }),
      completeOnboarding: () => set({ onboarded: true }),
      reset: () => set({ onboarded: false, walletKind: null, phone: null, phoneVerified: false }),
    }),
    {
      name: 'holdback.settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ lang, onboarded, walletKind, phone, phoneVerified, pushWanted }) => ({
        lang,
        onboarded,
        walletKind,
        phone,
        phoneVerified,
        pushWanted,
      }),
      onRehydrateStorage: () => () => useSettings.setState({ hydrated: true }),
    },
  ),
);

/** The translator for the current language. Changing the language re-renders every caller. */
export function useT(): Translate {
  const lang = useSettings((state) => state.lang);
  return useCallback<Translate>((key, vars) => translate(lang, key, vars), [lang]);
}

export function useLang(): Lang {
  return useSettings((state) => state.lang);
}
