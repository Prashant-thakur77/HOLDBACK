import type { MetadataRoute } from 'next';

import { publicEnv } from '@/lib/env';
import { SITE_PAGES } from '@/lib/site';

/**
 * Only fixed public pages are listed. Receipts (`/h/…`) and Dojo runs are
 * public but unbounded and reached through shared links, so they are not
 * enumerated.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return SITE_PAGES.map((page) => ({
    url: `${publicEnv.siteUrl}${page.href}`,
    changeFrequency: 'weekly',
    priority: page.href === '/' ? 1 : 0.7,
  }));
}
