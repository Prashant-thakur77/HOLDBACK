import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { publicEnv } from '@/lib/env';

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: { default: 'HOLDBACK', template: '%s · HOLDBACK' },
  description:
    'Every Solana payment gets an undo window enforced on-chain, sized by a risk agent from cited scam evidence.',
};

// Structure only, visual design pending: the design pass adds fonts, styles and chrome here.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
