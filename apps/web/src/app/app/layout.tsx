import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { WalletProviders } from '@/components/WalletProviders';

export const metadata: Metadata = { title: 'App', robots: { index: false } };

// Wallet context for the dashboard only, so public pages do not load wallet code.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
