import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { hmacSha256Hex, sha256, sha256Hex, toHex, utf8 } from '../src/sha256';

describe('sha256', () => {
  it('matches the published test vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches Node for every length around the block boundaries', () => {
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 5000]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(toHex(sha256(bytes)), `length ${length}`).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
    }
  });

  it('hashes text as UTF-8', () => {
    const text = 'किराया दो दिन late — ¿me mandas lo del mes? ✓';
    expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    expect(utf8('é')).toEqual(new Uint8Array([0xc3, 0xa9]));
  });
});

describe('hmacSha256Hex', () => {
  it('matches Node for short and longer-than-block keys', () => {
    for (const key of ['k', 'a-secret-of-normal-length', 'x'.repeat(64), 'y'.repeat(200)]) {
      expect(hmacSha256Hex(key, 'seed:run-1')).toBe(
        createHmac('sha256', key).update('seed:run-1').digest('hex'),
      );
    }
  });
});
