/**
 * Creates or updates the "Holdback Guardian" agent in ElevenLabs from the
 * definition in `src/voice/agent-config.ts`. Safe to run again: tools and
 * the agent are matched by name and updated in place.
 *
 *   npm run voice:setup --workspace services/agent
 *
 * Needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID. Prints the agent id to
 * put in ELEVENLABS_AGENT_ID.
 */
import { LANGS } from '@holdback/sdk';

import {
  AGENT_NAME,
  CLIENT_TOOLS,
  FIRST_MESSAGES,
  PLACEHOLDERS,
  SYSTEM_PROMPT,
  type ClientTool,
} from '../src/voice/agent-config';
import { loadEnv, requireVar } from './env';

const API = 'https://api.elevenlabs.io';
/** Model that holds the conversation; any id the agents platform accepts. */
const AGENT_LLM = process.env.ELEVENLABS_AGENT_LLM || 'claude-sonnet-5';
/** Low-latency multilingual speech model for live conversation. */
const AGENT_TTS_MODEL = process.env.ELEVENLABS_AGENT_TTS_MODEL || 'eleven_v4_turbo';
/** How long the app has to answer a tool call that touches the chain. */
const TOOL_TIMEOUT_SECS = 30;

const env = loadEnv();
const apiKey = requireVar(env, 'ELEVENLABS_API_KEY');
const voiceId = requireVar(env, 'ELEVENLABS_VOICE_ID');

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function toolConfig(tool: ClientTool) {
  return {
    tool_config: {
      type: 'client',
      name: tool.name,
      description: tool.description,
      expects_response: true,
      response_timeout_secs: TOOL_TIMEOUT_SECS,
      parameters: tool.parameters,
    },
  };
}

/** Creates each client tool, or updates the one that already has its name. Returns the ids. */
async function syncTools(): Promise<string[]> {
  const listed = (await call('GET', '/v1/convai/tools')) as {
    tools?: { id: string; tool_config?: { name?: string } }[];
  };
  const byName = new Map((listed.tools ?? []).map((tool) => [tool.tool_config?.name, tool.id]));
  const ids: string[] = [];
  for (const tool of CLIENT_TOOLS) {
    const existing = byName.get(tool.name);
    if (existing) {
      await call('PATCH', `/v1/convai/tools/${existing}`, toolConfig(tool));
      ids.push(existing);
    } else {
      const created = (await call('POST', '/v1/convai/tools', toolConfig(tool))) as { id: string };
      ids.push(created.id);
    }
    console.log(`tool ${tool.name}: ${existing ? 'updated' : 'created'}`);
  }
  return ids;
}

function systemTool(name: 'end_call' | 'language_detection') {
  return { type: 'system', name, description: '', params: { system_tool_type: name } };
}

function agentBody(toolIds: string[]) {
  const presets = Object.fromEntries(
    LANGS.filter((lang) => lang !== 'en').map((lang) => [
      lang,
      { overrides: { agent: { first_message: FIRST_MESSAGES[lang] } } },
    ]),
  );
  return {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGES.en,
        language: 'en',
        dynamic_variables: { dynamic_variable_placeholders: PLACEHOLDERS },
        prompt: {
          prompt: SYSTEM_PROMPT,
          llm: AGENT_LLM,
          temperature: 0.2,
          tool_ids: toolIds,
          built_in_tools: {
            end_call: systemTool('end_call'),
            language_detection: systemTool('language_detection'),
          },
        },
      },
      tts: { model_id: AGENT_TTS_MODEL, voice_id: voiceId },
      language_presets: presets,
    },
    platform_settings: {
      // Sessions start only with a signed URL or token from this service.
      auth: { enable_auth: true },
      // The app may choose the language for a session; nothing else.
      overrides: { conversation_config_override: { agent: { language: true } } },
    },
  };
}

async function findAgent(): Promise<string | null> {
  const listed = (await call(
    'GET',
    `/v1/convai/agents?search=${encodeURIComponent(AGENT_NAME)}&page_size=30`,
  )) as { agents?: { agent_id: string; name: string }[] };
  return listed.agents?.find((agent) => agent.name === AGENT_NAME)?.agent_id ?? null;
}

async function main(): Promise<void> {
  const toolIds = await syncTools();
  const body = agentBody(toolIds);
  const existing = env.ELEVENLABS_AGENT_ID || (await findAgent());
  let agentId: string;
  if (existing) {
    await call('PATCH', `/v1/convai/agents/${existing}`, body);
    agentId = existing;
    console.log('agent updated');
  } else {
    agentId = ((await call('POST', '/v1/convai/agents/create', body)) as { agent_id: string })
      .agent_id;
    console.log('agent created');
  }
  console.log(`ELEVENLABS_AGENT_ID=${agentId}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
