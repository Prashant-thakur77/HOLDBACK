import type { MetadataRoute } from 'next';

import { publicEnv } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The dashboard is per-wallet and the API is not content.
        disallow: ['/app', '/api/'],
      },
    ],
    sitemap: `${publicEnv.siteUrl}/sitemap.xml`,
  };
}
