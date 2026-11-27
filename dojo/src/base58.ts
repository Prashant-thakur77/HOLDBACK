/** Base58 (Bitcoin alphabet), enough to validate and print Solana addresses. */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ADDRESS_BYTES = 32;

/** Returns the decoded bytes, or `null` when the text is not base58. */
export function decodeBase58(text: string): Uint8Array | null {
  if (text.length === 0) return null;
  const bytes: number[] = [];
  for (const char of text) {
    let carry = ALPHABET.indexOf(char);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading '1' is one leading zero byte.
  for (const char of text) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export function encodeBase58(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let text = '';
  // Each leading zero byte is one leading '1'.
  for (const byte of bytes) {
    if (byte !== 0) break;
    text += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) text += ALPHABET[digits[i]!];
  return text;
}

/** True when the text decodes to exactly 32 bytes, the size of a Solana address. */
export function isSolanaAddress(text: string): boolean {
  return decodeBase58(text)?.length === ADDRESS_BYTES;
}

/** `5Acj…kUu1`, the way wallets shorten an address. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
