'use client';

import type { Lang } from '@holdback/sdk';

import { useLang } from '@/components/LangProvider';

/**
 * The risk agent's explanation in the reader's language when the agent wrote
 * one in it, otherwise in English. The text is the agent's, not a translation
 * made here.
 */
export function Spoken({ spoken }: { spoken: Partial<Record<Lang, string>> }) {
  const { lang } = useLang();
  const shown: Lang | null = spoken[lang] ? lang : spoken.en ? 'en' : null;
  if (!shown) return null;
  return (
    <blockquote className="spoken" lang={shown}>
      <p>{spoken[shown]}</p>
    </blockquote>
  );
}
