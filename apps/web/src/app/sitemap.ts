import type { MetadataRoute } from 'next';

import { publicEnv } from '@/lib/env';

/**
 * Only fixed public pages are listed. Receipts (`/h/…`) and Dojo runs are
 * public but unbounded and reached through shared links, so they are not
 * enumerated.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${publicEnv.siteUrl}/`, changeFrequency: 'weekly', priority: 1 }];
}
