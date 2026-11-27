/** ElevenLabs calls: text to speech, session credentials and outbound calls. */
import type { Lang } from '@holdback/sdk';

import type { Env } from '../env';
import { unavailable } from '../errors';
import { UpstreamError, postJson, request, requestJson } from '../lib/http';

const API = 'https://api.elevenlabs.io';
/** Newest multilingual speech model; override with `ELEVENLABS_TTS_MODEL`. */
export const DEFAULT_TTS_MODEL = 'eleven_v4';
/** Used when the configured model is refused for this account or endpoint. */
export const FALLBACK_TTS_MODEL = 'eleven_multilingual_v2';

function apiKey(env: Env): string {
  if (!env.ELEVENLABS_API_KEY) throw unavailable('Voice is not configured', 'voice_unavailable');
  return env.ELEVENLABS_API_KEY;
}

async function speak(env: Env, text: string, lang: Lang, model: string): Promise<ArrayBuffer> {
  const voice = env.ELEVENLABS_VOICE_ID;
  if (!voice) throw unavailable('ELEVENLABS_VOICE_ID is not configured', 'voice_unavailable');
  const response = await request(`${API}/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    timeoutMs: 20_000,
    headers: { 'xi-api-key': apiKey(env), 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: model,
      // The v2 multilingual model detects the language itself and rejects this field.
      ...(model === FALLBACK_TTS_MODEL ? {} : { language_code: lang }),
    }),
  });
  return response.arrayBuffer();
}

/** MP3 audio of `text`. Retries once on the fallback model when the first is refused. */
export async function textToSpeech(env: Env, text: string, lang: Lang): Promise<ArrayBuffer> {
  const model = env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL;
  try {
    return await speak(env, text, lang, model);
  } catch (error) {
    const refused = error instanceof UpstreamError && [400, 422].includes(error.status);
    if (!refused || model === FALLBACK_TTS_MODEL) throw error;
    return speak(env, text, lang, FALLBACK_TTS_MODEL);
  }
}

export interface SessionCredentials {
  agentId: string;
  signedUrl: string | null;
  conversationToken: string | null;
}

/**
 * Short-lived credentials for one conversation with the Guardian agent: a
 * signed WebSocket URL and a WebRTC token. Either may be `null` if its
 * endpoint fails; both failing is an error.
 */
export async function sessionCredentials(env: Env): Promise<SessionCredentials> {
  const agentId = env.ELEVENLABS_AGENT_ID;
  if (!agentId) throw unavailable('ELEVENLABS_AGENT_ID is not configured', 'voice_unavailable');
  const headers = { 'xi-api-key': apiKey(env) };
  const query = `agent_id=${encodeURIComponent(agentId)}`;
  const [signed, token] = await Promise.allSettled([
    requestJson(`${API}/v1/convai/conversation/get-signed-url?${query}`, { headers }),
    requestJson(`${API}/v1/convai/conversation/token?${query}`, { headers }),
  ]);
  const signedUrl =
    signed.status === 'fulfilled'
      ? ((signed.value as { signed_url?: string }).signed_url ?? null)
      : null;
  const conversationToken =
    token.status === 'fulfilled' ? ((token.value as { token?: string }).token ?? null) : null;
  if (!signedUrl && !conversationToken) {
    throw unavailable('Could not start a voice session', 'voice_unavailable');
  }
  return { agentId, signedUrl, conversationToken };
}

/** Places a phone call from the Guardian agent. Returns the conversation id, if any. */
export async function outboundCall(
  env: Env,
  toNumber: string,
  lang: Lang,
  dynamicVariables: Record<string, string | number | boolean>,
): Promise<string | null> {
  const agentId = env.ELEVENLABS_AGENT_ID;
  const phoneNumberId = env.ELEVENLABS_PHONE_NUMBER_ID;
  if (!agentId || !phoneNumberId) {
    throw unavailable('Outbound calls are not configured', 'voice_unavailable');
  }
  const answer = (await postJson(
    `${API}/v1/convai/twilio/outbound-call`,
    {
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number: toNumber,
      conversation_initiation_client_data: {
        dynamic_variables: dynamicVariables,
        conversation_config_override: { agent: { language: lang } },
      },
    },
    { timeoutMs: 10_000, headers: { 'xi-api-key': apiKey(env) } },
  )) as { success?: boolean; conversation_id?: string | null };
  if (answer.success === false) throw new Error('outbound call was not accepted');
  return answer.conversation_id ?? null;
}
