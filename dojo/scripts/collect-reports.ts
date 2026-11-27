/**
 * Collects public scam reports with Firecrawl into `data/reports.jsonl`.
 *
 *   FIRECRAWL_API_KEY=fc-... npm run collect --workspace dojo
 *   npm run collect --workspace dojo -- --limit 3      # fewer results per query
 *
 * It searches the web for each pattern the corpus covers (Firecrawl's search
 * endpoint scrapes the results in the same call) and scrapes the advisory
 * pages the corpus already cites. Every line of the output is one page:
 * its URL, its published date when the page states one, and a short excerpt.
 *
 * The file is reading material for whoever writes scenarios. Scenarios are
 * always written from scratch; nothing is copied from an excerpt into the
 * corpus.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ADVISORY } from '../src/scenarios';

const API = 'https://api.firecrawl.dev/v2';
const DEFAULT_OUTPUT = join(__dirname, '..', 'data', 'reports.jsonl');
const DEFAULT_LIMIT = 5;
const EXCERPT_CHARS = 700;
const MIN_PARAGRAPH_CHARS = 120;
const RETRY_AFTER_FALLBACK_MS = 10_000;

/** One search per pattern, phrased the way victims and agencies describe it. */
export const QUERIES: { category: string; query: string }[] = [
  {
    category: 'authority_impersonation',
    query: '"digital arrest" scam video call police victim report',
  },
  {
    category: 'authority_impersonation',
    query: 'estafa llamada falsa autoridad tributaria pago inmediato denuncia',
  },
  {
    category: 'fake_support',
    query: 'fake exchange support direct message asked to send crypto to verify wallet',
  },
  { category: 'remote_access', query: 'screen sharing app refund call bank scam warning' },
  {
    category: 'verification_transfer',
    query: 'P2P crypto trade "verification transfer" scam release funds',
  },
  { category: 'account_unlock', query: 'KYC expired SMS account blocked scam advisory' },
  { category: 'investment', query: 'WhatsApp group guaranteed daily returns trading scam victims' },
  { category: 'investment', query: 'fake trading platform pay tax to withdraw profits scam' },
  { category: 'romance', query: 'romance scam asked for money to travel never met report' },
  {
    category: 'family_emergency',
    query: 'golpe do novo número WhatsApp filho pede dinheiro alerta',
  },
  { category: 'job_fee', query: 'task scam prepaid task top up to withdraw earnings warning' },
  { category: 'marketplace', query: 'scan QR code to receive payment marketplace seller scam' },
  {
    category: 'invoice_fraud',
    query: 'supplier changed bank details email invoice fraud business warning',
  },
  {
    category: 'address_poisoning',
    query: 'address poisoning look-alike address transaction history lost funds',
  },
  { category: 'airdrop_drainer', query: 'fake airdrop claim site wallet drainer approval warning' },
  { category: 'parcel_fee', query: 'package held customs fee text message scam alert' },
  { category: 'rental_deposit', query: 'rental listing scam deposit before viewing owner abroad' },
  { category: 'charity', query: 'fake disaster relief charity donation scam warning' },
  { category: 'recovery_scam', query: 'crypto recovery service upfront fee scam warning' },
];

export interface Report {
  url: string;
  title: string;
  /** ISO date the page says it was published, or null when it does not say. */
  date: string | null;
  collected_at: string;
  category: string;
  /** The search that found the page; null for pages scraped directly. */
  query: string | null;
  excerpt: string;
}

/** The parts of a Firecrawl document this script reads. */
interface FirecrawlDocument {
  url?: string;
  title?: string;
  description?: string;
  markdown?: string | null;
  /** News results carry their own date. */
  date?: string;
  metadata?: Record<string, unknown>;
}

interface SearchResponse {
  success?: boolean;
  data?: { web?: FirecrawlDocument[]; news?: FirecrawlDocument[] };
  creditsUsed?: number;
  error?: string;
}

interface ScrapeResponse {
  success?: boolean;
  data?: FirecrawlDocument;
  error?: string;
}

const DATE_KEYS = [
  'publishedTime',
  'article:published_time',
  'datePublished',
  'date',
  'dc.date',
  'modifiedTime',
  'article:modified_time',
];

function firstText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

/** The page's own published date as `YYYY-MM-DD`, or null. Never guessed. */
export function publishedDate(document: FirecrawlDocument): string | null {
  const candidates = [document.date, ...DATE_KEYS.map((key) => document.metadata?.[key])];
  for (const candidate of candidates) {
    const text = firstText(candidate);
    if (!text) continue;
    const time = Date.parse(text);
    if (!Number.isNaN(time)) return new Date(time).toISOString().slice(0, 10);
  }
  return null;
}

const RELEVANT = /scam|fraud|phish|impersonat|estafa|fraude|golpe|घोटाला|धोखा/i;

/** A short plain-text excerpt: the first paragraphs that talk about fraud. */
export function excerptOf(document: FirecrawlDocument): string {
  const paragraphs = (document.markdown ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .replace(/[#>*_`|]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((paragraph) => paragraph.length >= MIN_PARAGRAPH_CHARS);
  const relevant = paragraphs.filter((paragraph) => RELEVANT.test(paragraph));
  const chosen = (relevant.length > 0 ? relevant : paragraphs).slice(0, 2).join(' ');
  const text = chosen || (document.description ?? '').trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : text;
}

function toReport(
  document: FirecrawlDocument,
  category: string,
  query: string | null,
  collectedAt: string,
): Report | null {
  const url = firstText(document.metadata?.sourceURL) ?? document.url;
  const excerpt = excerptOf(document);
  if (!url || !excerpt) return null;
  return {
    url,
    title: (firstText(document.metadata?.title) ?? document.title ?? '').trim(),
    date: publishedDate(document),
    collected_at: collectedAt,
    category,
    query,
    excerpt,
  };
}

export class FirecrawlError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface CollectOptions {
  apiKey: string;
  limit?: number;
  output?: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  now?: () => Date;
  queries?: typeof QUERIES;
  advisoryUrls?: string[];
}

function categoryOfAdvisory(url: string): string {
  const name = Object.entries(ADVISORY).find(([, value]) => value === url)?.[0];
  return name ? `advisory:${name}` : 'advisory';
}

function readExisting(path: string): Map<string, Report> {
  const reports = new Map<string, Report>();
  if (!existsSync(path)) return reports;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const report = JSON.parse(line) as Report;
    reports.set(report.url, report);
  }
  return reports;
}

/**
 * Runs every search and scrape, merges the results into the output file and
 * returns what it found. Pages already in the file are kept as they are.
 */
export async function collect(options: CollectOptions): Promise<{ added: number; total: number }> {
  const output = options.output ?? DEFAULT_OUTPUT;
  const fetcher = options.fetch ?? fetch;
  const log = options.log ?? console.log;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const collectedAt = (options.now?.() ?? new Date()).toISOString();
  const reports = readExisting(output);
  const known = reports.size;

  async function post<T>(path: string, body: unknown, retried = false): Promise<T> {
    const response = await fetcher(`${API}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (response.status === 429 && !retried) {
      const seconds = Number(response.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RETRY_AFTER_FALLBACK_MS;
      log(`rate limited, waiting ${Math.round(waitMs / 1000)} s`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return post<T>(path, body, true);
    }
    const text = await response.text();
    let payload: { error?: string } | null = null;
    try {
      payload = JSON.parse(text) as { error?: string };
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new FirecrawlError(response.status, payload?.error ?? `HTTP ${response.status}`);
    }
    return payload as T;
  }

  function keep(document: FirecrawlDocument, category: string, query: string | null): void {
    const report = toReport(document, category, query, collectedAt);
    if (report && !reports.has(report.url)) reports.set(report.url, report);
  }

  /** Runs one request; a failed one is logged and skipped, except when credits ran out. */
  async function attempt(label: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (error instanceof FirecrawlError && error.status === 402) throw error;
      log(`skipped ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const { category, query } of options.queries ?? QUERIES) {
    await attempt(`search "${query}"`, async () => {
      const result = await post<SearchResponse>('/search', {
        query,
        limit,
        sources: ['web'],
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });
      const found = result.data?.web ?? [];
      for (const document of found) keep(document, category, query);
      log(`${category}: ${found.length} results for "${query}"`);
    });
  }

  for (const url of options.advisoryUrls ?? Object.values(ADVISORY)) {
    if (reports.has(url)) continue;
    await attempt(`scrape ${url}`, async () => {
      const result = await post<ScrapeResponse>('/scrape', {
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      });
      if (result.data) keep({ ...result.data, url }, categoryOfAdvisory(url), null);
      log(`advisory: scraped ${url}`);
    });
  }

  const lines = [...reports.values()]
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((report) => JSON.stringify(report));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, lines.length > 0 ? `${lines.join('\n')}\n` : '');
  return { added: reports.size - known, total: reports.size };
}

async function main(): Promise<void> {
  const envFile = join(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error(
      'FIRECRAWL_API_KEY is not set. Get a key at https://www.firecrawl.dev/app/api-keys and put it in dojo/.env (see .env.example). Nothing was collected.',
    );
    process.exit(1);
  }
  const limitFlag = process.argv.indexOf('--limit');
  const limit = limitFlag > 0 ? Number(process.argv[limitFlag + 1]) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    console.error('--limit must be a whole number from 1 to 100.');
    process.exit(1);
  }
  const { added, total } = await collect({ apiKey, limit });
  console.log(`Added ${added} pages; ${DEFAULT_OUTPUT} now holds ${total}.`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
