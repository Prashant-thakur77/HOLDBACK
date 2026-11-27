/**
 * Amount entry. Money is always handled as integer base units (`bigint`);
 * floating point never touches it.
 */

export type AmountError = 'empty' | 'format' | 'decimals' | 'zero' | 'insufficient';

export type ParsedAmount = { ok: true; value: bigint } | { ok: false; error: AmountError };

/**
 * Parses what a person typed into base units. Accepts a comma as the decimal
 * separator (common on Hindi, Spanish and Portuguese keyboards) and ignores
 * surrounding spaces. Group separators are rejected instead of guessed at:
 * "1,234" must not silently become 1.234 or 1234.
 */
export function parseAmountInput(text: string, decimals: number): ParsedAmount {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'empty' };

  const separators = trimmed.match(/[.,]/g) ?? [];
  if (separators.length > 1) return { ok: false, error: 'format' };
  const normalised = trimmed.replace(',', '.');

  const match = /^(\d*)(?:\.(\d*))?$/.exec(normalised);
  if (!match || (match[1] === '' && (match[2] ?? '') === '')) return { ok: false, error: 'format' };

  const whole = match[1] === '' ? '0' : match[1]!;
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) return { ok: false, error: 'decimals' };

  const value = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (value === 0n) return { ok: false, error: 'zero' };
  return { ok: true, value };
}

/** Adds the balance check on top of `parseAmountInput`. A `null` balance is unknown and not checked. */
export function validateAmount(
  text: string,
  decimals: number,
  balance: bigint | null,
): ParsedAmount {
  const parsed = parseAmountInput(text, decimals);
  if (!parsed.ok) return parsed;
  if (balance !== null && parsed.value > balance) return { ok: false, error: 'insufficient' };
  return parsed;
}

/**
 * Base units to a display string, exact, with at most `maxFraction` decimal
 * places (extra digits are cut, never rounded up: a balance must not look
 * larger than it is).
 */
export function formatUnits(amount: bigint, decimals: number, maxFraction = decimals): string {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction =
    decimals > 0 ? digits.slice(-decimals).slice(0, maxFraction).replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Keeps only characters that can be part of an amount while the user types. */
export function sanitizeAmountInput(text: string): string {
  return text.replace(/[^\d.,]/g, '').slice(0, 24);
}
