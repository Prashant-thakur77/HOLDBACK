import { describe, expect, it } from 'vitest';

import { cellForWindow } from '@/components/art/Ticket';
import { clockLabel, localDigits, windowLabel } from '@/lib/i18n';
import { isBareRoute, isStoryRoute, pageFor } from '@/lib/site';
import { tierForHours } from '@/lib/windows';

const WINDOWS = [
  { plain: 'Someone you trust', windowSecs: 0 },
  { plain: 'Someone new', windowSecs: 1800 },
  { plain: 'Looks suspicious', windowSecs: 21600 },
  { plain: 'Flagged wallet', windowSecs: 86400 },
  { plain: 'On a sanctions list', windowSecs: 259200 },
];

describe('tierForHours', () => {
  it('names the tier whose window is exactly that long', () => {
    expect(tierForHours(0.5, WINDOWS)).toBe('30 minutes is the window for someone new.');
    expect(tierForHours(6, WINDOWS)).toBe('6 hours is the window for looks suspicious.');
    expect(tierForHours(72, WINDOWS)).toBe('72 hours is the window for on a sanctions list.');
  });

  it('points at the next window up when no tier matches', () => {
    expect(tierForHours(3, WINDOWS)).toBe(
      'No tier stops at 3 hours. The next window up is 6 hours, for looks suspicious.',
    );
    expect(tierForHours(1, WINDOWS)).toContain('No tier stops at 1 hour.');
  });

  it('never matches the tier with no window', () => {
    expect(tierForHours(96, WINDOWS)).toBe('No tier runs to 96 hours.');
  });
});

describe('ticket punch position', () => {
  it('leaves a ticket with no window unpunched', () => {
    expect(cellForWindow(0)).toBeNull();
  });

  it('punches the half-hour cell, the hour cells, and the two day cells', () => {
    expect(cellForWindow(1800)).toBe(0);
    expect(cellForWindow(21600)).toBe(6);
    expect(cellForWindow(86400)).toBe(24);
    expect(cellForWindow(172800)).toBe(25);
    expect(cellForWindow(259200)).toBe(26);
  });
});

describe('routes', () => {
  it('keeps the richer motion off the app screens', () => {
    for (const path of ['/app', '/h/abc', '/pay', '/proof', '/dojo/watch/run']) {
      expect(isStoryRoute(path)).toBe(false);
    }
    for (const path of ['/', '/how-it-works', '/dojo', '/docs']) {
      expect(isStoryRoute(path)).toBe(true);
    }
  });

  it('renders only the spectator page without the site shell', () => {
    expect(isBareRoute('/dojo/watch/run')).toBe(true);
    expect(isBareRoute('/dojo')).toBe(false);
  });

  it('finds a page by its exact path', () => {
    expect(pageFor('/evidence')?.page).toBe(3);
    expect(pageFor('/app')).toBeNull();
    expect(pageFor('/proof')?.ink).toBe('ochre');
  });
});

describe('numerals and durations', () => {
  it('sets digits in Devanagari for Hindi only', () => {
    expect(localDigits('25', 'hi')).toBe('२५');
    expect(localDigits('25', 'es')).toBe('25');
  });

  it('prints a window in words', () => {
    expect(windowLabel(0, 'en')).toBe('No wait');
    expect(windowLabel(1800, 'en')).toBe('30 minutes');
    expect(windowLabel(3600, 'pt')).toBe('1 hora');
    expect(windowLabel(21600, 'hi')).toBe('६ घंटे');
  });

  it('prints a countdown as a clock and never below zero', () => {
    expect(clockLabel(3661, 'en')).toBe('01:01:01');
    expect(clockLabel(-5, 'en')).toBe('00:00:00');
  });
});
