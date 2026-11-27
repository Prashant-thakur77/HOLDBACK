/** Worker entry: the HTTP API and the Cron Triggers. */
import { createApp } from './app';
import { runScheduled } from './cron';
import type { Background, Env } from './env';
import { createServices } from './services';

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled(controller: { cron: string; scheduledTime: number }, env: Env, ctx: Background): void {
    ctx.waitUntil(
      runScheduled(createServices(env, ctx), controller.cron, controller.scheduledTime),
    );
  },
};
