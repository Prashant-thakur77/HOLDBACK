/**
 * HS256 JSON Web Tokens on WebCrypto. Used for relay sessions, sign-in
 * challenges and the Supabase-compatible wallet session.
 */
import { base64ToBytes, bytesToBase64Url, utf8 } from './encoding';

export type Claims = Record<string, unknown> & { exp: number };

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    usage,
  ]);
}

const encodePart = (value: unknown) => bytesToBase64Url(utf8(JSON.stringify(value)));

export async function signJwt(claims: Claims, secret: string): Promise<string> {
  const head = `${encodePart({ alg: 'HS256', typ: 'JWT' })}.${encodePart(claims)}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), utf8(head));
  return `${head}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/** Returns the claims of a valid, unexpired token, or `null`. */
export async function verifyJwt(
  token: string,
  secret: string,
  nowSecs = Math.floor(Date.now() / 1000),
): Promise<Claims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  try {
    const parsedHeader = JSON.parse(new TextDecoder().decode(base64ToBytes(header))) as {
      alg?: string;
    };
    if (parsedHeader.alg !== 'HS256') return null;
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret, 'verify'),
      base64ToBytes(signature) as BufferSource,
      utf8(`${header}.${payload}`),
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(base64ToBytes(payload))) as Claims;
    if (typeof claims.exp !== 'number' || claims.exp <= nowSecs) return null;
    return claims;
  } catch {
    return null;
  }
}
