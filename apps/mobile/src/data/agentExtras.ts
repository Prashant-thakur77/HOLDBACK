import { GuardianError } from '@holdback/sdk';

import { config, hasAgent } from '@/config';

import { guardian } from './guardian';

/**
 * Agent endpoints the SDK's `GuardianClient` has no method for yet. Same
 * conventions: JSON in and out, `{ error: { code, message } }` on failure,
 * and the active session token as a bearer.
 */
export async function agentRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  if (!hasAgent) throw new GuardianError(0, 'not_configured', 'No Guardian server configured');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (guardian.token) headers.authorization = `Bearer ${guardian.token}`;

  const response = await fetch(`${config.agentUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new GuardianError(
      response.status,
      error?.code ?? 'http_error',
      error?.message ?? `Request failed with status ${response.status}`,
    );
  }
  return payload as T;
}
