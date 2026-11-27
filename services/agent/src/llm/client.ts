/**
 * One small interface over two chat APIs. The model is used for exactly
 * three jobs (classify the sender's note, extract quotes from web pages,
 * word the spoken explanation) and every answer is parsed against a strict
 * schema before anything else sees it. It never sees or sets the tier.
 */
import type { z } from 'zod';

import type { Env } from '../env';
import { postJson } from '../lib/http';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
const ANTHROPIC_VERSION = '2026-10-21';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Room for the model's reasoning plus a short JSON answer. */
const MAX_TOKENS = 4_096;

export interface LlmRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** JSON Schema of the answer, for providers that can enforce it. */
  jsonSchema: Record<string, unknown>;
  timeoutMs: number;
}

export interface LlmClient {
  provider: 'anthropic' | 'openai';
  model: string;
  /** Resolves with a validated answer; rejects on any failure, refusal or schema mismatch. */
  complete<T>(request: LlmRequest<T>): Promise<T>;
}

/**
 * Parses a model answer: optional code fence removed, JSON parsed, schema
 * enforced. Throws on anything else, so a malformed answer can only ever
 * lead to the deterministic fallback.
 */
export function parseModelJson<T>(text: string, schema: z.ZodType<T>): T {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const parsed: unknown = JSON.parse(fenced ? fenced[1]! : trimmed);
  return schema.parse(parsed);
}

/** Models that accept the server-side refusal fallback. */
const supportsFallbacks = (model: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
/** Models that accept `output_config.effort`. */
const supportsEffort = (model: string) => !/^claude-haiku-4/.test(model);

function anthropicClient(apiKey: string, model: string): LlmClient {
  return {
    provider: 'anthropic',
    model,
    async complete(request) {
      const fallbacks = supportsFallbacks(model);
      const answer = (await postJson(
        'https://api.anthropic.com/v1/messages',
        {
          model,
          max_tokens: MAX_TOKENS,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          output_config: {
            ...(supportsEffort(model) ? { effort: 'low' } : {}),
            format: { type: 'json_schema', schema: request.jsonSchema },
          },
          ...(fallbacks ? { fallbacks: 'default' } : {}),
        },
        {
          timeoutMs: request.timeoutMs,
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            ...(fallbacks ? { 'anthropic-beta': FALLBACK_BETA } : {}),
          },
        },
      )) as { stop_reason?: string; content?: { type: string; text?: string }[] };
      if (answer.stop_reason !== 'end_turn') {
        throw new Error(`model stopped with ${answer.stop_reason ?? 'no reason'}`);
      }
      const text = (answer.content ?? []).find((block) => block.type === 'text')?.text;
      if (!text) throw new Error('model returned no text');
      return parseModelJson(text, request.schema);
    },
  };
}

function openaiClient(apiKey: string, model: string): LlmClient {
  return {
    provider: 'openai',
    model,
    async complete(request) {
      const answer = (await postJson(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: { type: 'json_object' },
        },
        { timeoutMs: request.timeoutMs, headers: { authorization: `Bearer ${apiKey}` } },
      )) as { choices?: { finish_reason?: string; message?: { content?: string | null } }[] };
      const choice = answer.choices?.[0];
      if (choice?.finish_reason !== 'stop' || !choice.message?.content) {
        throw new Error('model returned no complete answer');
      }
      return parseModelJson(choice.message.content, request.schema);
    },
  };
}

/** The configured model client, or `null` when its key is not set. */
export function createLlm(env: Env): LlmClient | null {
  if ((env.LLM_PROVIDER ?? 'anthropic').toLowerCase() === 'openai') {
    return env.OPENAI_API_KEY
      ? openaiClient(env.OPENAI_API_KEY, env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL)
      : null;
  }
  return env.ANTHROPIC_API_KEY
    ? anthropicClient(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL)
    : null;
}
