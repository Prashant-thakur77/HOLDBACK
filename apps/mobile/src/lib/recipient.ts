import { isAddress } from './address';

/** What the text in the recipient field is. */
export type RecipientInput =
  | { kind: 'empty' }
  | { kind: 'address'; address: string }
  | { kind: 'name'; name: string }
  | { kind: 'invalid' };

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*\.(sol|skr)$/;

export function classifyRecipient(text: string): RecipientInput {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (isAddress(trimmed)) return { kind: 'address', address: trimmed };
  const lower = trimmed.toLowerCase();
  if (NAME_PATTERN.test(lower)) return { kind: 'name', name: lower };
  return { kind: 'invalid' };
}

/** A payment request read from a QR code. */
export interface ScannedPayment {
  recipient: string;
  /** Decimal amount as written in the code, when present. */
  amount: string | null;
  /** SPL mint named by the code, when present. */
  mint: string | null;
  label: string | null;
}

/**
 * Reads a scanned QR code. Understands a bare address, a `.sol` / `.skr`
 * name, a `solana:<address>?amount=…&spl-token=…` payment URL and this app's
 * `holdback://send?to=…` link. Anything else is `null`: the scanner keeps
 * looking instead of filling the form with something the user did not mean.
 */
export function parseScannedCode(data: string): ScannedPayment | null {
  const text = data.trim();
  const bare = classifyRecipient(text);
  if (bare.kind === 'address') return plain(bare.address);
  if (bare.kind === 'name') return plain(bare.name);

  const solanaPay = /^solana:([^?]+)(?:\?(.*))?$/i.exec(text);
  if (solanaPay) {
    const target = classifyRecipient(decodeURIComponent(solanaPay[1]!));
    if (target.kind !== 'address') return null;
    const query = parseQuery(solanaPay[2] ?? '');
    return {
      recipient: target.address,
      amount: decimalOrNull(query.get('amount')),
      mint: isAddress(query.get('spl-token')) ? query.get('spl-token')! : null,
      label: query.get('label') ?? null,
    };
  }

  const own = /^holdback:\/\/send\/?\?(.*)$/i.exec(text);
  if (own) {
    const query = parseQuery(own[1]!);
    const target = classifyRecipient(query.get('to') ?? '');
    if (target.kind !== 'address' && target.kind !== 'name') return null;
    return {
      recipient: target.kind === 'address' ? target.address : target.name,
      amount: decimalOrNull(query.get('amount')),
      mint: isAddress(query.get('mint')) ? query.get('mint')! : null,
      label: null,
    };
  }
  return null;
}

const plain = (recipient: string): ScannedPayment => ({
  recipient,
  amount: null,
  mint: null,
  label: null,
});

function decimalOrNull(value: string | undefined): string | null {
  return value && /^\d+(\.\d+)?$/.test(value) ? value : null;
}

/** A small query-string reader, so parsing does not depend on the runtime's `URL`. */
function parseQuery(query: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [key, value = ''] = pair.split('=');
    try {
      out.set(decodeURIComponent(key!), decodeURIComponent(value.replace(/\+/g, ' ')));
    } catch {
      // a malformed escape makes only this pair unusable
    }
  }
  return out;
}
