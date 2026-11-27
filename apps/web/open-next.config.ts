import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * Every page that shows money is rendered per request from the chain and the
 * agent, so there is no incremental cache to persist and no R2 bucket to
 * provision. Add an `incrementalCache` override here if static regeneration
 * is introduced later.
 */
export default defineCloudflareConfig({});
