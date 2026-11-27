import { isAddress } from './address';
import { parseScannedCode } from './recipient';

/** Where a link or a notification tap should take the user. */
export type DeepLinkTarget =
  { kind: 'hold'; pda: string } | { kind: 'send'; recipient: string; amount: string | null };

/**
 * Parses `holdback://hold/<pda>` and `holdback://send?to=…`. The hold address
 * is validated here because it comes from outside the app (a push payload or
 * another app) and ends up in a route and in RPC calls.
 */
export function parseDeepLink(url: string | null | undefined): DeepLinkTarget | null {
  if (!url) return null;
  const text = url.trim();

  const hold = /^holdback:\/\/\/?hold\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(text);
  if (hold) {
    const pda = hold[1]!;
    return isAddress(pda) ? { kind: 'hold', pda } : null;
  }

  if (/^holdback:\/\/send/i.test(text)) {
    const payment = parseScannedCode(text);
    return payment ? { kind: 'send', recipient: payment.recipient, amount: payment.amount } : null;
  }
  return null;
}

/**
 * A push notification carries either a ready link (`url`) or the hold address
 * (`hold`). Values arrive as untyped JSON, so both are checked.
 */
export function targetFromNotification(data: unknown): DeepLinkTarget | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.url === 'string') {
    const target = parseDeepLink(record.url);
    if (target) return target;
  }
  if (typeof record.hold === 'string' && isAddress(record.hold)) {
    return { kind: 'hold', pda: record.hold };
  }
  return null;
}

/** The in-app route for a target. */
export function routeFor(target: DeepLinkTarget): string {
  if (target.kind === 'hold') return `/hold/${target.pda}`;
  const amount = target.amount ? `&amount=${encodeURIComponent(target.amount)}` : '';
  return `/send?to=${encodeURIComponent(target.recipient)}${amount}`;
}
