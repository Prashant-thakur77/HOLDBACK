import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { LANGS } from '@holdback/sdk';

import type { Env } from '../env';
import { badRequest } from '../errors';
import { isPubkey } from '../lib/solana';
import type { Services } from '../services';

export type AppEnv = { Bindings: Env; Variables: { services: Services } };
export type App = Hono<AppEnv>;
export type Ctx = Context<AppEnv>;

const U64_MAX = (1n << 64n) - 1n;

export const address = z.string().refine(isPubkey, 'must be a Solana address');
/** A positive base-unit amount that fits a u64. */
export const amount = z
  .string()
  .regex(/^[1-9]\d{0,19}$/, 'must be a positive whole number of base units')
  // The pattern check does not stop later checks, so this one must not assume digits.
  .refine((value) => !/^\d+$/.test(value) || BigInt(value) <= U64_MAX, 'is too large');
export const lang = z.enum(LANGS);
export const evidenceHash = z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 hex characters');

/** Parses the JSON body against `schema`; anything else is a 400. */
export async function body<T>(c: Ctx, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('The request body must be JSON');
  }
  return parse(schema, raw);
}

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    throw badRequest(`${path ? `${path} ` : ''}${issue?.message ?? 'is invalid'}`.trim());
  }
  return result.data;
}
