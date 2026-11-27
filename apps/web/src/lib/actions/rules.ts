import type { ActionsJson } from '@solana/actions-spec';

import { PAY_ACTION_PATH } from './pay';

/**
 * `actions.json`: tells Blink clients which URLs on this site are Actions.
 *
 * - `/pay?to=…` is the link people share. Clients map it to the API and
 *   carry the query string over; a browser without Blink support opens the
 *   page at the same path.
 * - The API path maps to itself so a raw API link unfurls too.
 */
export const ACTIONS_JSON: ActionsJson = {
  rules: [
    { pathPattern: '/pay', apiPath: PAY_ACTION_PATH },
    { pathPattern: '/api/actions/**', apiPath: '/api/actions/**' },
  ],
};
