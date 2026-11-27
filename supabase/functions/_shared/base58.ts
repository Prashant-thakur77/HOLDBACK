const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 (Bitcoin alphabet) of arbitrary bytes: the text form of a Solana address. */
export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  let out = '';
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  // Each leading zero byte is one leading '1'; the big-integer form drops them.
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}
