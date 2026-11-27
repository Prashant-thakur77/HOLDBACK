/**
 * Normalises a phone number to E.164 (`+` and 8 to 15 digits), or returns
 * `null`. Spaces, dashes, dots and brackets are ignored; a number without a
 * country code is rejected because a call could reach the wrong person.
 */
export function normalisePhone(input: string): string | null {
  const compact = input.replace(/[\s\-().]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

/** `+919876543210` -> `+91 ••••••3210`, for showing a saved number without exposing it in full. */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return e164;
  const head = e164.slice(0, 3);
  const tail = e164.slice(-4);
  return `${head} ${'•'.repeat(e164.length - 7)}${tail}`;
}
