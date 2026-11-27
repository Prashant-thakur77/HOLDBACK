import type { Lang } from '@holdback/sdk';

import { en } from './en';
import { es } from './es';
import { hi } from './hi';
import { pt } from './pt';
import type { Dictionary, MessageKey, MessageVars, Plural } from './types';

export const DICTIONARIES: Record<Lang, Dictionary> = { en, hi, es, pt };

/** Each language named in itself, for the language picker. */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: 'English',
  hi: 'हिन्दी',
  es: 'Español',
  pt: 'Português',
};

/** BCP 47 tags for speech recognition and date formatting. */
export const LOCALE_TAGS: Record<Lang, string> = {
  en: 'en-US',
  hi: 'hi-IN',
  es: 'es-ES',
  pt: 'pt-BR',
};

function lookup(dictionary: Dictionary, key: string): string | Plural | undefined {
  let node: unknown = dictionary;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node as string | Plural | undefined;
}

function fill(template: string, vars: MessageVars | undefined): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Looks a message up in `lang`, falling back to English and then to the key
 * itself. A plural pair is chosen by `vars.n`.
 */
export function translate(lang: Lang, key: MessageKey, vars?: MessageVars): string {
  const found = lookup(DICTIONARIES[lang], key) ?? lookup(en, key);
  if (found === undefined) return key;
  if (typeof found === 'string') return fill(found, vars);
  return fill(Number(vars?.n) === 1 ? found.one : found.other, vars);
}

export type Translate = (key: MessageKey, vars?: MessageVars) => string;

/**
 * A window length in words, in at most two units: `30 minutes`,
 * `1 hour 30 minutes`, `3 days`. Zero is the word for an instant transfer.
 */
export function formatWindow(totalSecs: number, t: Translate): string {
  const secs = Math.max(0, Math.floor(totalSecs));
  if (secs === 0) return t('duration.instant');
  const units = [
    ['duration.day', 86_400],
    ['duration.hour', 3_600],
    ['duration.minute', 60],
    ['duration.second', 1],
  ] as const;
  const parts: string[] = [];
  let rest = secs;
  for (const [key, size] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(t(key, { n }));
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

/** Every leaf of a dictionary as `path -> text` (plural pairs as `path.one` / `path.other`). */
export function flatten(dictionary: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (!dictionary || typeof dictionary !== 'object') return out;
  for (const [key, value] of Object.entries(dictionary)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [inner, text] of flatten(value, path)) out.set(inner, text);
  }
  return out;
}

/** The `{placeholders}` used by a message, sorted. */
export function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!))].sort();
}

/** Picks the app language for a device locale tag such as `pt-BR`; English when unsupported. */
export function langFromLocale(tag: string | null | undefined): Lang {
  const base = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return base === 'hi' || base === 'es' || base === 'pt' ? base : 'en';
}
