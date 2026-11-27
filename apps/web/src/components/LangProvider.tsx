'use client';

import type { Lang } from '@holdback/sdk';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { isLang, translate, type MessageKey } from '@/lib/i18n';

const STORAGE_KEY = 'holdback.lang';

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: 'en',
  setLang: () => undefined,
  t: (key) => translate('en', key),
});

/** Reads the reader's saved choice; storage can be blocked, which is not an error. */
function storedLang(): Lang | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (isLang(fromUrl)) return fromUrl;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isLang(saved) ? saved : null;
  } catch {
    return null;
  }
}

/**
 * Holds the interface language. The server always renders English; the
 * saved choice is applied after hydration so the first client render matches
 * the server's.
 */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    const saved = storedLang();
    if (saved) setLangState(saved);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still holds for this visit.
    }
  }, []);

  const value = useMemo<LangContextValue>(
    () => ({ lang, setLang, t: (key) => translate(lang, key) }),
    [lang, setLang],
  );
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}

/**
 * One translated string, tagged with its language so screen readers switch
 * voice and the type rules for Devanagari apply. The page itself stays
 * `lang="en"` because its long-form text is English. Renders English on the server.
 */
export function T({ k }: { k: MessageKey }) {
  const { lang, t } = useLang();
  return lang === 'en' ? <>{t(k)}</> : <span lang={lang}>{t(k)}</span>;
}
