import type { Hold } from './accounts';
import { HoldOrigin, HoldStatus, Tier, tierName } from './constants';

/** `90061` -> `1 day 1 hour`; at most two units, never zero-length. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds === 0) return '0 seconds';
  const units: [string, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ];
  const parts: string[] = [];
  let rest = seconds;
  for (const [name, size] of units) {
    const count = Math.floor(rest / size);
    if (count > 0) {
      parts.push(`${count} ${name}${count === 1 ? '' : 's'}`);
      rest -= count * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

/** `1500000n, 6` -> `1.5`. Exact: no floating point. */
export function formatAmount(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? digits.slice(-decimals).replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** `"1.5", 6` -> `1500000n`. Throws on more decimals than the mint has. */
export function parseAmount(text: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new Error('Enter an amount like 12.50');
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) throw new Error(`At most ${decimals} decimal places`);
  return BigInt(match[1]! + fraction.padEnd(decimals, '0'));
}

function shortAddress(address: { toBase58(): string }): string {
  const text = address.toBase58();
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

export interface ExplainOptions {
  /** Unix seconds. Defaults to the local clock. */
  now?: number;
  /** Token symbol and decimals, for a readable amount. */
  symbol?: string;
  decimals?: number;
}

const TIER_REASON: Record<number, string> = {
  [Tier.TRUSTED]: 'you trust this recipient',
  [Tier.UNKNOWN]: 'nothing is known about this recipient yet',
  [Tier.SUSPICIOUS]: 'there are warning signs about this recipient',
  [Tier.FLAGGED]: 'this recipient has been reported for scams',
  [Tier.SANCTIONED]: 'this recipient is on a sanctions list',
};

/** One plain sentence describing where a hold stands. */
export function explain(hold: Hold, options: ExplainOptions = {}): string {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const decimals = options.decimals ?? (hold.isSol ? 9 : 0);
  const symbol = options.symbol ?? (hold.isSol ? 'SOL' : 'tokens');
  const amount = `${formatAmount(hold.amount, decimals)} ${symbol}`;
  const to = shortAddress(hold.recipient);

  if (hold.status === HoldStatus.RECLAIMED) {
    return `${amount} meant for ${to} was returned to the sender.`;
  }
  if (hold.status === HoldStatus.RELEASED) {
    return `${amount} was released to ${to}.`;
  }

  const remaining = hold.releaseAt - now;
  if (remaining <= 0) {
    return `${amount} for ${to} has passed its undo window and can be released now.`;
  }
  const who =
    hold.origin === HoldOrigin.DEPOSIT_BOX ? 'The sender (or their relayer)' : 'The sender';
  const why = TIER_REASON[hold.tier] ?? `the risk tier is ${tierName(hold.tier)}`;
  return (
    `${amount} is on hold for ${to}. ${who} can undo it for another ` +
    `${formatDuration(remaining)} because ${why}.`
  );
}
