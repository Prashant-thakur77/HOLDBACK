/**
 * The public pages, in reading order. Each has its own ink, used for its
 * patch in the navigation and for its page opener, and a page number that
 * the "continued on page N" links refer to.
 */
import type { MessageKey } from './i18n';

export interface SitePage {
  href: string;
  label: MessageKey;
  ink: 'ink' | 'blue' | 'magenta' | 'green' | 'copper' | 'red' | 'water' | 'ochre';
  page: number;
  /** One line for the contents sheet and the footer. */
  summary: string;
}

export const SITE_PAGES: SitePage[] = [
  {
    href: '/',
    label: 'nav.home',
    ink: 'ink',
    page: 1,
    summary: 'What a hold is, and the bowl you can lift.',
  },
  {
    href: '/how-it-works',
    label: 'nav.how',
    ink: 'blue',
    page: 2,
    summary: 'One payment, from assessment to undo or release.',
  },
  {
    href: '/evidence',
    label: 'nav.evidence',
    ink: 'magenta',
    page: 3,
    summary: 'The evidence hash, and what each key can and cannot do.',
  },
  {
    href: '/results',
    label: 'nav.results',
    ink: 'green',
    page: 4,
    summary: 'What was measured, and what has run where.',
  },
  {
    href: '/integrations',
    label: 'nav.integrations',
    ink: 'copper',
    page: 5,
    summary: 'Seeker, Pollar, ElevenLabs, Firecrawl, Supabase, Byte.',
  },
  {
    href: '/dojo',
    label: 'nav.dojo',
    ink: 'red',
    page: 6,
    summary: 'Eight payment requests. Should you pay?',
  },
  {
    href: '/docs',
    label: 'nav.docs',
    ink: 'water',
    page: 7,
    summary: 'Run it, program id, accounts, questions.',
  },
  {
    href: '/proof',
    label: 'nav.proof',
    ink: 'ochre',
    page: 8,
    summary: 'Try to rob it: every attack, refused on-chain, and re-checked by your browser.',
  },
  {
    href: '/try',
    label: 'nav.try',
    ink: 'green',
    page: 9,
    summary:
      'Fall for a scam on purpose and take the money back, on devnet, with no wallet to install.',
  },
];

export const PROGRAM_ID = '26Tx1zAiL26RfxqTAVDaFaD2TTVku4Hm2vy3LBw8unom';
export const CONFIG_ADDRESS = 'Cz9e3k72qaDnQJNo6deUXVdE823HcFrhkV36Zj92s9tw';

/** Routes that render without the site header and footer (embedded in a frame). */
export function isBareRoute(pathname: string): boolean {
  return pathname.startsWith('/dojo/watch/');
}

/**
 * A real hold on devnet, opened while the system was tested end to end. It
 * gives a first-time visitor a receipt to open and a hash to recompute
 * without owning a wallet. If it is ever closed, its receipt still renders
 * from the recorded copy and says so.
 */
export const EXAMPLE_HOLD = 'GAVEL3zT8wQDsS1LimSsaABMu4m8w4skmsmsz4fhgWrg';

/** Story pages get the richer motion; app screens and the proof table stay calm. */
export function isStoryRoute(pathname: string): boolean {
  return !['/app', '/h/', '/pay', '/proof', '/try', '/dojo/watch/'].some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

export function pageFor(pathname: string): SitePage | null {
  return SITE_PAGES.find((page) => page.href === pathname) ?? null;
}
