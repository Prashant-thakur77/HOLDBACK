import { describe, expect, it } from 'vitest';

import { formatUnits, parseAmountInput, sanitizeAmountInput, validateAmount } from '@/lib/amount';

describe('parseAmountInput', () => {
  it('parses whole and fractional amounts into base units', () => {
    expect(parseAmountInput('12', 6)).toEqual({ ok: true, value: 12_000_000n });
    expect(parseAmountInput('12.5', 6)).toEqual({ ok: true, value: 12_500_000n });
    expect(parseAmountInput('0.000001', 6)).toEqual({ ok: true, value: 1n });
    expect(parseAmountInput('  3.25 ', 2)).toEqual({ ok: true, value: 325n });
  });

  it('accepts a comma as the decimal separator', () => {
    expect(parseAmountInput('12,50', 6)).toEqual({ ok: true, value: 12_500_000n });
  });

  it('accepts a leading or trailing separator', () => {
    expect(parseAmountInput('.5', 6)).toEqual({ ok: true, value: 500_000n });
    expect(parseAmountInput('5.', 6)).toEqual({ ok: true, value: 5_000_000n });
  });

  it('is exact for amounts floating point cannot represent', () => {
    expect(parseAmountInput('0.1', 9)).toEqual({ ok: true, value: 100_000_000n });
    expect(parseAmountInput('123456789012.123456', 6)).toEqual({
      ok: true,
      value: 123_456_789_012_123_456n,
    });
  });

  it('rejects empty, malformed and ambiguous input', () => {
    expect(parseAmountInput('', 6)).toEqual({ ok: false, error: 'empty' });
    expect(parseAmountInput('   ', 6)).toEqual({ ok: false, error: 'empty' });
    expect(parseAmountInput('abc', 6)).toEqual({ ok: false, error: 'format' });
    expect(parseAmountInput('.', 6)).toEqual({ ok: false, error: 'format' });
    expect(parseAmountInput('-5', 6)).toEqual({ ok: false, error: 'format' });
    expect(parseAmountInput('1e3', 6)).toEqual({ ok: false, error: 'format' });
    expect(parseAmountInput('1,234.50', 6)).toEqual({ ok: false, error: 'format' });
    expect(parseAmountInput('1.2.3', 6)).toEqual({ ok: false, error: 'format' });
  });

  it('rejects more decimals than the token has instead of rounding', () => {
    expect(parseAmountInput('1.1234567', 6)).toEqual({ ok: false, error: 'decimals' });
    expect(parseAmountInput('1.5', 0)).toEqual({ ok: false, error: 'decimals' });
  });

  it('rejects zero', () => {
    expect(parseAmountInput('0', 6)).toEqual({ ok: false, error: 'zero' });
    expect(parseAmountInput('0.000', 6)).toEqual({ ok: false, error: 'zero' });
  });
});

describe('validateAmount', () => {
  it('rejects an amount above the balance', () => {
    expect(validateAmount('10.01', 6, 10_000_000n)).toEqual({ ok: false, error: 'insufficient' });
  });

  it('allows spending the exact balance', () => {
    expect(validateAmount('10', 6, 10_000_000n)).toEqual({ ok: true, value: 10_000_000n });
  });

  it('does not check an unknown balance', () => {
    expect(validateAmount('10', 6, null)).toEqual({ ok: true, value: 10_000_000n });
  });
});

describe('formatUnits', () => {
  it('formats exactly and trims trailing zeros', () => {
    expect(formatUnits(12_500_000n, 6)).toBe('12.5');
    expect(formatUnits(12_000_000n, 6)).toBe('12');
    expect(formatUnits(1n, 6)).toBe('0.000001');
    expect(formatUnits(0n, 6)).toBe('0');
  });

  it('groups thousands', () => {
    expect(formatUnits(1_234_567_000_000n, 6)).toBe('1,234,567');
  });

  it('cuts extra decimals without rounding up', () => {
    expect(formatUnits(1_999_999n, 6, 2)).toBe('1.99');
    expect(formatUnits(999_999n, 6, 2)).toBe('0.99');
  });

  it('round-trips through parseAmountInput', () => {
    const text = formatUnits(987_654_321n, 6).replace(/,/g, '');
    expect(parseAmountInput(text, 6)).toEqual({ ok: true, value: 987_654_321n });
  });
});

describe('sanitizeAmountInput', () => {
  it('keeps only digits and separators', () => {
    expect(sanitizeAmountInput('$1 2a.5,0')).toBe('12.5,0');
  });
});
