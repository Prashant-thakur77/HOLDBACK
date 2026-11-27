/**
 * Look-alike detection for .sol names: does a name imitate a well-known
 * one through similar-looking characters, a one-letter change, or by
 * wrapping it in words like "support"?
 */

/** Names people recognise and scammers imitate. Lowercase, without `.sol`. */
export const WELL_KNOWN_NAMES = [
  'solana',
  'phantom',
  'solflare',
  'backpack',
  'jupiter',
  'raydium',
  'orca',
  'marinade',
  'jito',
  'kamino',
  'drift',
  'pyth',
  'helius',
  'magiceden',
  'tensor',
  'metaplex',
  'squads',
  'wormhole',
  'bonfida',
  'circle',
  'tether',
  'binance',
  'coinbase',
  'kraken',
  'bybit',
  'okx',
  'bitget',
  'kucoin',
  'robinhood',
  'paypal',
  'ledger',
  'trezor',
  'superteam',
  'solanamobile',
  'seeker',
  'holdback',
] as const;

/** Words that turn a brand into an impersonation when attached to it. */
const IMPERSONATION_WORDS = [
  'support',
  'help',
  'helpdesk',
  'official',
  'security',
  'secure',
  'team',
  'admin',
  'airdrop',
  'claim',
  'verify',
  'refund',
  'recovery',
  'giveaway',
  'rewards',
  'wallet',
];

/** Characters that read as another character. Multi-character pairs come first. */
const CONFUSABLE_PAIRS: [string, string][] = [
  ['rn', 'm'],
  ['vv', 'w'],
  ['cl', 'd'],
];
const CONFUSABLE_CHARS: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  i: 'l',
  '|': 'l',
  // Cyrillic
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  х: 'x',
  у: 'y',
  к: 'k',
  м: 'm',
  т: 't',
  н: 'h',
  в: 'b',
  ѕ: 's',
  і: 'l',
  ј: 'j',
  // Greek
  α: 'a',
  ο: 'o',
  ρ: 'p',
  ε: 'e',
  ν: 'v',
  τ: 't',
  κ: 'k',
  ι: 'l',
};

/** Strips `.sol`, lowercases and removes accents. */
export function baseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.sol$/, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * What a name looks like at a glance: separators dropped and every
 * confusable character replaced by the one it resembles.
 */
export function skeleton(name: string): string {
  let text = baseName(name).replace(/[-_.\s]/g, '');
  for (const [pair, single] of CONFUSABLE_PAIRS) text = text.split(pair).join(single);
  return [...text].map((char) => CONFUSABLE_CHARS[char] ?? char).join('');
}

/** Edit distance where swapping two neighbouring letters counts as one edit. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

/** Shortest well-known name that edit distance is applied to; shorter ones collide by chance. */
export const MIN_LENGTH_FOR_EDIT_DISTANCE = 5;
/** Names of this length or more may differ by two edits. */
export const LONG_NAME_LENGTH = 9;

/**
 * The well-known name that `name` imitates, or `null`. A well-known name
 * itself is never a look-alike.
 */
export function lookalikeOf(name: string): string | null {
  const plain = baseName(name);
  if (plain === '' || (WELL_KNOWN_NAMES as readonly string[]).includes(plain)) return null;
  const shape = skeleton(name);

  for (const known of WELL_KNOWN_NAMES) {
    const knownShape = skeleton(known);
    // Same shape, different characters: homoglyphs or separators.
    if (shape === knownShape) return known;
    // Brand wrapped in an impersonation word: "phantom-support", "officialbinance".
    if (known.length >= 4 && shape.includes(knownShape)) {
      const rest = shape.replace(knownShape, '');
      if (IMPERSONATION_WORDS.some((word) => rest === skeleton(word))) return known;
    }
    if (known.length >= MIN_LENGTH_FOR_EDIT_DISTANCE) {
      const allowed = known.length >= LONG_NAME_LENGTH ? 2 : 1;
      if (editDistance(shape, knownShape) <= allowed) return known;
    }
  }
  return null;
}
