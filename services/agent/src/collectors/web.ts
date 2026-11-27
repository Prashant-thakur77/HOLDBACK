/**
 * Collector 5: what the open web says, through Firecrawl. One search with
 * inline markdown finds pages about the exact address (and its .sol name),
 * pages that came back without text are scraped, and `web-extract` keeps
 * only those that really name the identifier.
 *
 * When the recipient is a token mint rather than a wallet, Firecrawl's
 * DeFiLlama data provider adds what token it is.
 */
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@holdback/sdk';

import { CollectorUnavailable } from '../errors';
import { withTimeout, postJson } from '../lib/http';
import type { Services } from '../services';
import type { Signal } from '../signals';
import type { Collector } from './types';
import { extractReports, type WebReport, type WebSource } from './web-extract';

const FIRECRAWL = 'https://api.firecrawl.dev/v2';
export const SEARCH_LIMIT = 5;
/** Results without inline text that are scraped individually. */
export const MAX_SCRAPES = 3;
const CACHE_TTL_SECS = 6 * 3_600;
/** How long the web collector waits for the name lookup before searching without it. */
const NAME_WAIT_MS = 1_500;
/** Explorers show every address, so a hit there says nothing. */
const EXCLUDED_DOMAINS = [
  'solscan.io',
  'explorer.solana.com',
  'solana.fm',
  'solanabeach.io',
  'xray.helius.xyz',
  'orb.helius.dev',
  'birdeye.so',
  'dexscreener.com',
];
const SCAM_QUERY_TERMS = '(scam OR fraud OR phishing OR drainer OR stolen OR hack)';

interface SearchResult {
  url?: string;
  title?: string;
  description?: string;
  markdown?: string;
  metadata?: Record<string, unknown>;
}

const headers = (apiKey: string) => ({ authorization: `Bearer ${apiKey}` });

function publishedDate(metadata: Record<string, unknown> | undefined): string | undefined {
  for (const key of ['publishedTime', 'article:published_time', 'datePublished', 'modifiedTime']) {
    const value = metadata?.[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') return first;
  }
  return undefined;
}

/** One search that also returns each result's page as markdown. */
export async function search(apiKey: string, query: string): Promise<SearchResult[]> {
  const answer = (await postJson(
    `${FIRECRAWL}/search`,
    {
      query,
      limit: SEARCH_LIMIT,
      sources: ['web'],
      excludeDomains: EXCLUDED_DOMAINS,
      timeout: 15_000,
      scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
    },
    { timeoutMs: 16_000, headers: headers(apiKey) },
  )) as { data?: { web?: SearchResult[] } | SearchResult[] };
  const data = answer.data;
  return Array.isArray(data) ? data : (data?.web ?? []);
}

/** Scrapes one page to markdown. */
export async function scrape(apiKey: string, url: string): Promise<SearchResult> {
  const answer = (await postJson(
    `${FIRECRAWL}/scrape`,
    { url, formats: ['markdown'], onlyMainContent: true, timeout: 10_000 },
    { timeoutMs: 11_000, headers: headers(apiKey) },
  )) as { data?: SearchResult };
  return { url, ...answer.data };
}

/** Search, then fill in page text for the top results that came back without it. */
export async function gatherSources(apiKey: string, identifiers: string[]): Promise<WebSource[]> {
  const quoted = identifiers.map((identifier) => `"${identifier}"`).join(' OR ');
  const results = await search(apiKey, `${quoted} ${SCAM_QUERY_TERMS}`);
  const missing = results.filter((result) => result.url && !result.markdown).slice(0, MAX_SCRAPES);
  const scraped = await Promise.all(
    missing.map((result) => scrape(apiKey, result.url!).catch(() => null)),
  );
  const fromScrape = new Map(
    scraped.filter((page): page is SearchResult => page !== null).map((page) => [page.url, page]),
  );
  return results
    .filter((result): result is SearchResult & { url: string } => typeof result.url === 'string')
    .map((result) => {
      const page = fromScrape.get(result.url);
      return {
        url: result.url,
        title: result.title ?? '',
        text: result.markdown ?? page?.markdown ?? '',
        date: publishedDate(result.metadata ?? page?.metadata),
      };
    })
    .filter((source) => source.text !== '');
}

type RecipientKind = 'wallet' | 'token_mint' | 'program';

/** Whether the recipient address is a wallet, a token mint or a program on mainnet. */
export async function recipientKind(services: Services, address: string): Promise<RecipientKind> {
  const info = await services.mainnet.getAccountInfo(new PublicKey(address));
  if (!info) return 'wallet';
  if (info.executable) return 'program';
  const tokenOwned =
    info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID);
  // A classic mint is exactly 82 bytes; Token-2022 mints are longer and carry
  // the account-type byte 1 at offset 165.
  const isMint = tokenOwned && (info.data.length === 82 || info.data[165] === 1);
  return isMint ? 'token_mint' : 'wallet';
}

interface TokenPrice {
  symbol?: string;
  price?: number;
}

/** Token context from Firecrawl's DeFiLlama provider. `null` when the token is unknown to it. */
export async function tokenContext(apiKey: string, mint: string): Promise<TokenPrice | null> {
  const answer = (await postJson(
    `${FIRECRAWL}/scrape`,
    {
      alexandria: {
        provider: 'defillama-com',
        capability: 'crypto/prices',
        options: { coins: [`solana:${mint}`] },
      },
    },
    { timeoutMs: 8_000, headers: headers(apiKey) },
  )) as { data?: { alexandria?: { data?: { prices?: TokenPrice[] }; error?: unknown }[] } };
  const item = answer.data?.alexandria?.[0];
  if (!item || item.error) return null;
  return item.data?.prices?.[0] ?? null;
}

async function kindSignals(services: Services, apiKey: string, address: string): Promise<Signal[]> {
  const source = 'web_reports' as const;
  const kind = await recipientKind(services, address).catch(() => 'wallet' as const);
  if (kind === 'program') {
    return [
      {
        source,
        signal: 'recipient_is_program',
        detail:
          'This address is a program on mainnet. Money sent to a program address is usually lost.',
      },
    ];
  }
  if (kind !== 'token_mint') return [];
  const token = await tokenContext(apiKey, address).catch(() => null);
  const known = token?.symbol
    ? ` DeFiLlama lists it as ${token.symbol}${typeof token.price === 'number' ? ` at $${token.price}` : ''}.`
    : '';
  return [
    {
      source,
      signal: 'recipient_is_token_mint',
      detail: `This address is a token mint on mainnet, not a wallet.${known}`,
      url: token?.symbol ? `https://defillama.com/` : undefined,
    },
  ];
}

export function reportSignals(reports: WebReport[]): Signal[] {
  const source = 'web_reports' as const;
  if (reports.length === 0) {
    return [
      {
        source,
        signal: 'no_reports',
        detail: 'A web search found no page that names this address in a scam report.',
      },
    ];
  }
  return reports.map((report) => ({
    source,
    signal: 'scam_report',
    detail: report.claim,
    url: report.url,
    quote: report.quote,
    matched: report.matched,
    date: report.date,
  }));
}

export const webCollector: Collector = {
  name: 'web_reports',
  timeoutMs: 12_000,
  cacheTtlSecs: CACHE_TTL_SECS,
  async collect({ services, subject, llm, names }) {
    const apiKey = services.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new CollectorUnavailable('FIRECRAWL_API_KEY is not set');
    return services.cache.wrap('web_reports', subject.recipient, CACHE_TTL_SECS, async () => {
      const found = await withTimeout(names(), NAME_WAIT_MS).catch(() => null);
      const identifiers = [subject.recipient];
      if (found?.primary) identifiers.push(`${found.primary}.sol`);
      const [sources, kind] = await Promise.all([
        gatherSources(apiKey, identifiers),
        kindSignals(services, apiKey, subject.recipient),
      ]);
      const reports = await extractReports(llm, sources, identifiers);
      return [...reportSignals(reports), ...kind];
    });
  },
};
