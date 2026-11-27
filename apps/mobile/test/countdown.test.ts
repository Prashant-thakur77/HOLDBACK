import { describe, expect, it } from 'vitest';

import {
  clockParts,
  formatClock,
  remainingFraction,
  remainingSecs,
  totalWindowSecs,
  urgency,
} from '@/lib/countdown';

const created = '2026-11-27T10:00:00.000Z';
const release = '2026-11-27T10:30:00.000Z';
const at = (iso: string) => Date.parse(iso);

describe('remainingSecs', () => {
  it('counts whole seconds until release, rounding up', () => {
    expect(remainingSecs(release, at('2026-11-27T10:00:00.000Z'))).toBe(1_800);
    expect(remainingSecs(release, at('2026-11-27T10:29:59.400Z'))).toBe(1);
  });

  it('is zero at and after the release time', () => {
    expect(remainingSecs(release, at(release))).toBe(0);
    expect(remainingSecs(release, at('2026-11-27T11:00:00.000Z'))).toBe(0);
  });

  it('accepts unix seconds as well as ISO strings', () => {
    expect(remainingSecs(at(release) / 1000, at(created))).toBe(1_800);
  });

  it('is zero for a date that cannot be parsed', () => {
    expect(remainingSecs('not a date', at(created))).toBe(0);
  });
});

describe('remainingFraction', () => {
  it('goes from 1 at creation to 0 at release', () => {
    expect(remainingFraction(created, release, at(created))).toBe(1);
    expect(remainingFraction(created, release, at('2026-11-27T10:15:00.000Z'))).toBe(0.5);
    expect(remainingFraction(created, release, at(release))).toBe(0);
  });

  it('is clamped outside the window', () => {
    expect(remainingFraction(created, release, at('2026-11-27T09:00:00.000Z'))).toBe(1);
    expect(remainingFraction(created, release, at('2026-11-27T12:00:00.000Z'))).toBe(0);
  });

  it('is 0 for an empty or inverted window', () => {
    expect(remainingFraction(release, release, at(created))).toBe(0);
    expect(remainingFraction(release, created, at(created))).toBe(0);
  });
});

describe('formatClock', () => {
  it('uses the shortest form that fits', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(59)).toBe('00:59');
    expect(formatClock(1_799)).toBe('29:59');
    expect(formatClock(3_600)).toBe('01:00:00');
    expect(formatClock(86_400 + 2 * 3_600 + 3 * 60 + 4)).toBe('1d 02:03:04');
  });

  it('never shows a negative time', () => {
    expect(formatClock(-5)).toBe('00:00');
  });

  it('splits into parts', () => {
    expect(clockParts(90_061)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 });
  });
});

describe('urgency', () => {
  it('is calm for most of the window', () => {
    expect(urgency(1_500, 1_800)).toBe('calm');
  });

  it('is soon in the last quarter of a short window', () => {
    expect(urgency(440, 1_800)).toBe('soon');
  });

  it('is soon in the last hour of a long window, not its last quarter', () => {
    expect(urgency(7_200, 86_400)).toBe('calm');
    expect(urgency(3_500, 86_400)).toBe('soon');
  });

  it('is final in the last five minutes and over at zero', () => {
    expect(urgency(300, 86_400)).toBe('final');
    expect(urgency(1, 86_400)).toBe('final');
    expect(urgency(0, 86_400)).toBe('over');
  });
});

describe('totalWindowSecs', () => {
  it('is the length of the window', () => {
    expect(totalWindowSecs(created, release)).toBe(1_800);
  });
});
