/** The HTTP API. Every error leaves as `{ "error": { "code", "message" } }`. */
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import type { Background } from './env';
import { ApiError } from './errors';
import { assessRoutes } from './routes/assess';
import { authRoutes } from './routes/auth';
import { communityRoutes } from './routes/community';
import { holdRoutes } from './routes/holds';
import { opsRoutes } from './routes/ops';
import type { AppEnv } from './routes/shared';
import { voiceRoutes } from './routes/voice';
import { createServices } from './services';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['authorization', 'content-type', 'x-crank-secret'],
      exposeHeaders: ['x-holdback-storage'],
      maxAge: 86_400,
    }),
  );

  app.use('*', async (c, next) => {
    let background: Background | undefined;
    try {
      background = c.executionCtx;
    } catch {
      // No execution context outside the Workers runtime (tests).
    }
    const services = createServices(c.env ?? {}, background);
    c.set('services', services);
    await next();
    // Every answer says what kind of storage stands behind it.
    c.header('x-holdback-storage', services.storage.info.kind);
  });

  app.get('/', (c) =>
    c.json({ service: 'holdback-guardian', ok: true, storage: c.var.services.storage.info }),
  );

  assessRoutes(app);
  holdRoutes(app);
  communityRoutes(app);
  authRoutes(app);
  opsRoutes(app);
  voiceRoutes(app);

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'No such route' } }, 404));

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status as 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503 | 504,
      );
    }
    // Log the message only: never the request, the environment or a stack with arguments.
    console.error('unhandled error:', error instanceof Error ? error.message : 'unknown');
    return c.json({ error: { code: 'internal_error', message: 'Something went wrong' } }, 500);
  });

  return app;
}
