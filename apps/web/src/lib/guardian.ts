/**
 * Access to the risk agent ("Guardian"). The typed client lives in the SDK;
 * this module decides which base URL it talks to and adds the wallet-session
 * endpoints the web app needs for Realtime.
 */
import { GuardianClient, GuardianError } from '@holdback/sdk';
import { z } from 'zod';

import { publicEnv } from './env';
import { IntegrationUnavailableError } from './errors';

/** A `fetch` that gives up after `ms`, so a slow agent cannot hang a page or a route. */
export function fetchWithTimeout(ms: number): typeof fetch {
  return (input, init) =>
    fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) });
}

export interface GuardianOptions {
  baseUrl?: string | null;
  token?: string;
  fetch?: typeof fetch;
}

/** A client for the configured agent, or `null` when no agent URL is set. */
export function createGuardian(options: GuardianOptions = {}): GuardianClient | null {
  const baseUrl = options.baseUrl === undefined ? publicEnv.agentUrl : options.baseUrl;
  if (!baseUrl) return null;
  return new GuardianClient({ baseUrl, token: options.token, fetch: options.fetch });
}

/** Like `createGuardian`, for code paths that cannot continue without the agent. */
export function requireGuardian(options: GuardianOptions = {}): GuardianClient {
  const client = createGuardian(options);
  if (!client) {
    throw new IntegrationUnavailableError('agent', 'The risk agent is not configured');
  }
  return client;
}

/**
 * JSON request against the agent for endpoints the SDK client does not wrap.
 * Failures become the SDK's `GuardianError`, so callers handle one error type.
 */
export async function agentRequest<T>(
  path: string,
  options: {
    baseUrl: string;
    method?: 'GET' | 'POST';
    body?: unknown;
    headers?: Record<string, string>;
    schema: z.ZodType<T>;
    fetch?: typeof fetch;
  },
): Promise<T> {
  const fetcher = options.fetch ?? fetchWithTimeout(15_000);
  const response = await fetcher(`${options.baseUrl}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new GuardianError(
      response.status,
      error?.code ?? 'http_error',
      error?.message ?? `Request failed with status ${response.status}`,
    );
  }
  const parsed = options.schema.safeParse(payload);
  if (!parsed.success) {
    throw new GuardianError(502, 'bad_response', `Unexpected response from ${path}`);
  }
  return parsed.data;
}

const challengeSchema = z.object({
  /** The exact text the wallet signs. */
  message: z.string().min(1),
  /** Opaque token from the agent; returned untouched with the signature. */
  challenge: z.string().min(1),
});
export type AuthChallenge = z.infer<typeof challengeSchema>;

const sessionSchema = z.object({
  /** A JWT with the `wallet` claim, accepted by Supabase row-level security. */
  token: z.string().min(1),
  expiresAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
});

export interface WalletSession {
  token: string;
  wallet: string;
  /** ISO timestamp. */
  expiresAt: string;
}

/** Step 1 of wallet sign-in: the agent issues a one-time message for `wallet` to sign. */
export function requestAuthChallenge(baseUrl: string, wallet: string): Promise<AuthChallenge> {
  return agentRequest('/v1/auth/challenge', {
    baseUrl,
    body: { wallet },
    schema: challengeSchema,
  });
}

/**
 * Step 2: trade the challenge and the wallet's signature over its message
 * (base58 ed25519) for a session JWT.
 */
export async function exchangeAuthSignature(
  baseUrl: string,
  challenge: AuthChallenge,
  wallet: string,
  signature: string,
): Promise<WalletSession> {
  const session = await agentRequest('/v1/auth/session', {
    baseUrl,
    body: { wallet, challenge: challenge.challenge, signature },
    schema: sessionSchema,
  });
  return { ...session, wallet };
}
