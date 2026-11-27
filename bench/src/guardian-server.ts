/**
 * Serves the Guardian's HTTP API from a plain Node process.
 *
 * The eval and the benchmarks need the real service, and the Workers runtime
 * that `wrangler dev` starts cannot reach Solana's public RPC endpoints. The
 * app itself is runtime-neutral, so this wraps `createApp()` in `node:http`.
 * Nothing about the service is changed or replaced: the same collectors run,
 * and each reports "unavailable" when its key is missing.
 *
 *   npx tsx bench/src/guardian-server.ts [--port 8787]
 *
 * Prints `GUARDIAN_URL=http://127.0.0.1:<port>` once it is listening.
 * `GET /__environment` (added by this wrapper, not part of the API) says which
 * credentials are configured, by name only.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

import { createApp } from '../../services/agent/src/app';
import { configuredKeys, loadEnv } from './env';

/** Request bodies of this API are JSON, so text is enough. */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export interface RunningGuardian {
  url: string;
  close(): Promise<void>;
}

export async function startGuardian(
  env: Record<string, string>,
  port = 0,
): Promise<RunningGuardian> {
  const app = createApp();
  const server: Server = createServer((incoming, outgoing) => {
    void (async () => {
      const path = incoming.url ?? '/';
      if (path === '/__environment') {
        outgoing.writeHead(200, { 'content-type': 'application/json' });
        outgoing.end(JSON.stringify({ configured: configuredKeys(env), node: process.version }));
        return;
      }
      const method = incoming.method ?? 'GET';
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value);
      }
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const response = await app.fetch(
        new Request(`http://${incoming.headers.host ?? 'localhost'}${path}`, {
          method,
          headers,
          body: hasBody ? await readBody(incoming) : undefined,
        }),
        env,
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => {
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(
        JSON.stringify({ error: { code: 'internal_error', message: 'wrapper failed' } }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function portArgument(): number {
  const index = process.argv.indexOf('--port');
  const value = index >= 0 ? Number(process.argv[index + 1]) : 0;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startGuardian(loadEnv(), portArgument())
    .then((guardian) => console.log(`GUARDIAN_URL=${guardian.url}`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'could not start');
      process.exit(1);
    });
}
