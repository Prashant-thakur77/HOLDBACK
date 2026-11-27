/**
 * Seeded randomness. A run's whole deck comes from one seed string, so the
 * same seed always deals the same eight rounds on every platform.
 */
import { sha256, utf8 } from './sha256';

/** Returns a float in [0, 1). */
export type Rng = () => number;

/** sfc32 seeded from the first 16 bytes of sha256(seed). */
export function createRng(seed: string): Rng {
  const view = new DataView(sha256(utf8(seed)).buffer);
  let a = view.getUint32(0);
  let b = view.getUint32(4);
  let c = view.getUint32(8);
  let d = view.getUint32(12);
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11)) + t;
    c |= 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Fisher-Yates on a copy. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
