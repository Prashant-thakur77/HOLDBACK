import { LANGS } from '@holdback/sdk';
import { describe, expect, it } from 'vitest';

import {
  DICTIONARIES,
  LANGUAGE_NAMES,
  LOCALE_TAGS,
  flatten,
  formatWindow,
  langFromLocale,
  placeholders,
  translate,
  type Translate,
} from '@/i18n/translate';

const english = flatten(DICTIONARIES.en);
const others = LANGS.filter((lang) => lang !== 'en');

describe('translations', () => {
  it('covers the four languages of the product', () => {
    expect([...LANGS].sort()).toEqual(['en', 'es', 'hi', 'pt']);
    for (const lang of LANGS) {
      expect(DICTIONARIES[lang]).toBeDefined();
      expect(LANGUAGE_NAMES[lang]).toBeTruthy();
      expect(LOCALE_TAGS[lang]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it.each(others)('%s has exactly the keys English has', (lang) => {
    const keys = [...flatten(DICTIONARIES[lang]).keys()].sort();
    expect(keys).toEqual([...english.keys()].sort());
  });

  it.each(others)('%s has no empty strings', (lang) => {
    const empty = [...flatten(DICTIONARIES[lang])].filter(([, text]) => text.trim() === '');
    expect(empty).toEqual([]);
  });

  it.each(others)('%s uses the same placeholders as English in every message', (lang) => {
    const mismatched = [...flatten(DICTIONARIES[lang])]
      .filter(
        ([key, text]) => placeholders(text).join() !== placeholders(english.get(key) ?? '').join(),
      )
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it.each(others)('%s is actually translated', (lang) => {
    // Brand names, units and format labels are legitimately identical; prose must not be.
    const same = [...flatten(DICTIONARIES[lang])].filter(
      ([key, text]) => text === english.get(key) && /[a-z]{4,} [a-z]{4,}/i.test(text),
    );
    expect(same).toEqual([]);
  });

  it('keeps the required Pollar sentence in English', () => {
    expect(translate('en', 'pollar.note')).toBe(
      'Pollar accounts: refunds can only ever return to your own wallet.',
    );
  });

  it('never calls the Seeker badge a proof of being human', () => {
    for (const lang of LANGS) {
      expect(translate(lang, 'home.seekerBadge').toLowerCase()).not.toMatch(
        /human|humano|मानव|इंसान/,
      );
    }
    expect(translate('en', 'home.seekerBadge')).toBe('Verified Seeker owner');
  });
});

describe('translate', () => {
  it('fills placeholders', () => {
    expect(translate('en', 'home.to', { name: 'maya.sol' })).toBe('To maya.sol');
    expect(translate('es', 'home.to', { name: 'maya.sol' })).toBe('Para maya.sol');
  });

  it('leaves an unknown placeholder visible instead of printing "undefined"', () => {
    expect(translate('en', 'home.to')).toBe('To {name}');
  });

  it('chooses the plural form from n', () => {
    expect(translate('en', 'duration.hour', { n: 1 })).toBe('1 hour');
    expect(translate('en', 'duration.hour', { n: 6 })).toBe('6 hours');
    expect(translate('hi', 'duration.hour', { n: 1 })).toBe('1 घंटा');
    expect(translate('hi', 'duration.hour', { n: 6 })).toBe('6 घंटे');
  });
});

describe('formatWindow', () => {
  const t: Translate = (key, vars) => translate('en', key, vars);

  it('describes a window in at most two units', () => {
    expect(formatWindow(0, t)).toBe('Instant');
    expect(formatWindow(1_800, t)).toBe('30 minutes');
    expect(formatWindow(5_400, t)).toBe('1 hour 30 minutes');
    expect(formatWindow(21_600, t)).toBe('6 hours');
    expect(formatWindow(259_200, t)).toBe('3 days');
    expect(formatWindow(90_061, t)).toBe('1 day 1 hour');
  });

  it('follows the language', () => {
    expect(formatWindow(86_400, (key, vars) => translate('pt', key, vars))).toBe('1 dia');
  });
});

describe('langFromLocale', () => {
  it('maps device locales to supported languages', () => {
    expect(langFromLocale('pt-BR')).toBe('pt');
    expect(langFromLocale('es_MX')).toBe('es');
    expect(langFromLocale('hi-IN')).toBe('hi');
    expect(langFromLocale('en-GB')).toBe('en');
  });

  it('falls back to English', () => {
    expect(langFromLocale('fr-FR')).toBe('en');
    expect(langFromLocale(undefined)).toBe('en');
  });
});
