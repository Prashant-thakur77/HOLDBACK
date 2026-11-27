/**
 * Runs the Dojo API on this machine for manual play and for trying a client
 * against it. Runs live in memory and vanish when the process stops.
 *
 *   npm run dev --workspace dojo
 *   curl -s -X POST http://localhost:8787/api/dojo/runs
 *
 * With AGENT_URL set, `check_address` asks that HOLDBACK agent
 * (`POST /v1/assess`). With DOJO_SECRET set as well, the end-of-run memo is
 * requested from it (`POST /v1/dojo/memo`). Without them the game still
 * plays: the address verdict and the memo show as unavailable.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { createDojoHandler, type DojoAssess, type DojoMemoWriter } from '../src/http';
import { memoryStore } from '../src/stores';

const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 8787);
const agentUrl = process.env.AGENT_URL?.replace(/\/+$/, '');
const sharedSecret = process.env.DOJO_SECRET;
const baseUrl = `http://localhost:${port}/api/dojo`;

async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

const assess: DojoAssess = async (request) => {
  if (!agentUrl) throw new Error('AGENT_URL is not set');
  return postJson(`${agentUrl}/v1/assess`, request);
};

const writeMemo: DojoMemoWriter = async (memo) => {
  if (!agentUrl || !sharedSecret) throw new Error('AGENT_URL and DOJO_SECRET are not both set');
  const { signature } = await postJson<{ signature: string }>(`${agentUrl}/v1/dojo/memo`, memo, {
    authorization: `Bearer ${sharedSecret}`,
  });
  return signature;
};

const handler = createDojoHandler({
  store: memoryStore(),
  assess,
  writeMemo,
  baseUrl,
  // Without a configured secret every start of this server deals different decks.
  secret: sharedSecret ?? randomBytes(32).toString('hex'),
});

createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
  const response = await handler(
    new Request(`http://localhost:${port}${incoming.url ?? '/'}`, {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    }),
  );
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(await response.text());
}).listen(port, () => {
  console.log(`Scam Dojo API on ${baseUrl}`);
  console.log(`  agent: ${agentUrl ?? 'not configured (address verdicts unavailable)'}`);
  console.log(`  memo:  ${agentUrl && sharedSecret ? 'through the agent' : 'not configured'}`);
});
