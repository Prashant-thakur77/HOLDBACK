import { describe, expect, it } from 'vitest';

import {
  clampWindow,
  isBelowFloor,
  isInstant,
  windowBounds,
  windowOptions,
  type WindowInputs,
} from '@/lib/window';

const base: WindowInputs = { policySecs: 21_600, trusted: false, minSecs: 0, maxSecs: 259_200 };

describe('undo-window floor', () => {
  it('uses the policy window as the floor for a recipient who is not trusted', () => {
    expect(windowBounds(base)).toEqual({ floor: 21_600, ceiling: 259_200 });
  });

  it('never lets an untrusted sender go below the policy window', () => {
    const bounds = windowBounds(base);
    expect(clampWindow(0, bounds)).toBe(21_600);
    expect(clampWindow(1_800, bounds)).toBe(21_600);
    expect(isBelowFloor(1_800, bounds)).toBe(true);
    expect(isBelowFloor(21_600, bounds)).toBe(false);
  });

  it('lets the sender lengthen the window up to the program maximum', () => {
    const bounds = windowBounds(base);
    expect(clampWindow(86_400, bounds)).toBe(86_400);
    expect(clampWindow(999_999_999, bounds)).toBe(259_200);
  });

  it('drops the floor to the program minimum when the recipient is trusted', () => {
    const bounds = windowBounds({ ...base, trusted: true });
    expect(bounds.floor).toBe(0);
    expect(clampWindow(0, bounds)).toBe(0);
    expect(isInstant(clampWindow(0, bounds))).toBe(true);
  });

  it('respects a non-zero program minimum even for a trusted recipient', () => {
    const bounds = windowBounds({ ...base, trusted: true, minSecs: 60 });
    expect(bounds.floor).toBe(60);
    expect(clampWindow(0, bounds)).toBe(60);
  });

  it('raises a policy below the program minimum to that minimum', () => {
    expect(windowBounds({ ...base, policySecs: 10, minSecs: 60 }).floor).toBe(60);
  });

  it('caps the floor at the ceiling when policy exceeds the program maximum', () => {
    expect(windowBounds({ ...base, policySecs: 999_999, maxSecs: 86_400 })).toEqual({
      floor: 86_400,
      ceiling: 86_400,
    });
  });

  it('falls back to the floor for a value that is not a number', () => {
    expect(clampWindow(Number.NaN, windowBounds(base))).toBe(21_600);
  });
});

describe('window options', () => {
  it('offers the floor and only longer presets to an untrusted sender', () => {
    expect(windowOptions(base)).toEqual([21_600, 86_400, 259_200]);
  });

  it('offers instant, the policy window and every preset to a trusted sender', () => {
    expect(windowOptions({ ...base, trusted: true })).toEqual([
      0, 300, 1_800, 3_600, 21_600, 86_400, 259_200,
    ]);
  });

  it('keeps a policy window that is not a preset', () => {
    expect(windowOptions({ ...base, policySecs: 7_200 })).toEqual([7_200, 21_600, 86_400, 259_200]);
  });

  it('never offers anything above the ceiling', () => {
    const options = windowOptions({ ...base, policySecs: 1_800, maxSecs: 3_600 });
    expect(options).toEqual([1_800, 3_600]);
  });
});
