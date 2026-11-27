import { dojoHandler } from '@/lib/dojo/handler';

export const dynamic = 'force-dynamic';

/**
 * The Scam Dojo API: every path under /api/dojo goes to the engine's own
 * handler (start a run, read it, move, watch, retry the memo).
 */
function handle(request: Request): Promise<Response> {
  return dojoHandler(new URL(request.url).origin)(request);
}

/** The engine speaks GET and POST; a HEAD probe gets the GET answer without its body. */
async function head(request: Request): Promise<Response> {
  const response = await handle(new Request(request.url, { headers: request.headers }));
  return new Response(null, { status: response.status, headers: response.headers });
}

export { handle as GET, handle as POST, handle as OPTIONS, head as HEAD };
