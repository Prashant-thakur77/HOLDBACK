import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { LangProvider } from '@/components/LangProvider';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { SiteChrome } from '@/components/site/SiteChrome';
import { publicEnv } from '@/lib/env';

import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/art.css';
import '@/styles/chrome.css';
import '@/styles/home.css';
import '@/styles/pages.css';
import '@/styles/app.css';

const DESCRIPTION =
  'Every Solana payment gets an undo window enforced on-chain, sized by a risk agent from cited scam evidence.';

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: { default: 'HOLDBACK: every payment gets an undo window', template: '%s · HOLDBACK' },
  description: DESCRIPTION,
  openGraph: {
    title: 'HOLDBACK: every payment gets an undo window',
    description: DESCRIPTION,
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HOLDBACK' }],
  },
  twitter: { card: 'summary_large_image', images: ['/og.png'] },
};

export const viewport: Viewport = {
  themeColor: '#e7e8d6',
  width: 'device-width',
  initialScale: 1,
};

// Marks the document as scripted before first paint, so reveal start states
// never apply to a page whose scripts did not run.
const MARK_SCRIPTED = "document.documentElement.classList.add('js')";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/anek-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script dangerouslySetInnerHTML={{ __html: MARK_SCRIPTED }} />
      </head>
      <body>
        <LangProvider>
          <SiteChrome header={<Header />} footer={<Footer />}>
            {children}
          </SiteChrome>
        </LangProvider>
      </body>
    </html>
  );
}
