/**
 * Shared-secret check for the webhook. Helius sends the `authHeader` value
 * configured on the webhook verbatim in the `Authorization` header.
 */

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/**
 * Compares two strings without leaking where they differ. Both sides are
 * hashed first, so the loop always runs over 32 bytes and neither the
 * content nor the length of the secret shows up in the response time.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i]! ^ right[i]!;
  return difference === 0;
}

/**
 * True when the request carries the configured secret. An unset or empty
 * secret never matches: a deployment without one must reject everything.
 */
export async function isAuthorized(request: Request, secret: string | undefined): Promise<boolean> {
  const presented = request.headers.get('authorization');
  if (!secret || presented === null) return false;
  return timingSafeEqual(presented, secret);
}
