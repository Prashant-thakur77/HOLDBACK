import { describe, expect, it } from 'vitest';

import type { LlmClient } from '../src/llm/client';
import {
  MAX_QUOTE_WORDS,
  containsIdentifier,
  extractReports,
  extractionSchema,
  keywordReports,
  matchingSources,
  snippetsAround,
  verifyReports,
  type Extraction,
  type WebSource,
} from '../src/collectors/web-extract';

const ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
/** Same length, one character different: a different wallet. */
const NEAR_MISS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsV';
const NAME = 'phantom-support.sol';

const page = (url: string, text: string, date?: string): WebSource => ({
  url,
  title: 'A page',
  text,
  date,
});

const REPORT = page(
  'https://forum.example/thread/1',
  `Warning to everyone. The wallet ${ADDRESS} is a scam, it drained my account after I signed a fake airdrop claim. Stay away.`,
  '2026-10-02T10:00:00Z',
);
const OTHER_WALLET = page(
  'https://forum.example/thread/2',
  `The wallet ${NEAR_MISS} is a scam and stole funds from several people last week.`,
);
const NO_IDENTIFIER = page(
  'https://news.example/solana-scams',
  'Scams on Solana are rising. Drainers and phishing sites stole millions this year.',
);
const NEUTRAL = page(
  'https://list.example/holders',
  `Top holders this week: ${ADDRESS} with 1,200 tokens, followed by nine other wallets of similar size and age.`,
);

describe('exact identifier filter', () => {
  it('matches an address byte for byte', () => {
    expect(containsIdentifier(REPORT.text, ADDRESS)).toBe(true);
    expect(containsIdentifier(OTHER_WALLET.text, ADDRESS)).toBe(false);
    expect(containsIdentifier(REPORT.text.toLowerCase(), ADDRESS)).toBe(false);
    expect(containsIdentifier(REPORT.text, ADDRESS.slice(0, 20))).toBe(true);
    expect(containsIdentifier(REPORT.text, '')).toBe(false);
  });

  it('matches a .sol name whatever its case', () => {
    expect(containsIdentifier('Beware of Phantom-Support.SOL', NAME)).toBe(true);
    expect(containsIdentifier('Beware of phantom-supp0rt.sol', NAME)).toBe(false);
  });

  it('drops sources that do not contain an identifier', () => {
    const kept = matchingSources([REPORT, OTHER_WALLET, NO_IDENTIFIER, NEUTRAL], [ADDRESS, NAME]);
    expect(kept.map(({ source }) => source.url)).toEqual([REPORT.url, NEUTRAL.url]);
    expect(kept.every(({ matched }) => matched === ADDRESS)).toBe(true);
  });

  it('cuts excerpts around the identifier', () => {
    const long = `${'x '.repeat(2_000)}${ADDRESS}${' y'.repeat(2_000)}`;
    const [snippet] = snippetsAround(long, ADDRESS);
    expect(snippet).toContain(ADDRESS);
    expect(snippet!.length).toBeLessThan(1_100);
  });
});

describe('checking model output against the pages', () => {
  const extraction = (overrides: Partial<Extraction['reports'][number]>): Extraction => ({
    reports: [
      {
        url: REPORT.url,
        is_scam_report: true,
        claim: 'A forum user says this wallet drained their account.',
        quote: 'is a scam, it drained my account',
        date: '2026-10-02',
        matched: ADDRESS,
        ...overrides,
      },
    ],
  });
  const sources = [REPORT, NEUTRAL];

  it('keeps a report whose page, identifier and quote all check out', () => {
    expect(verifyReports(extraction({}), sources, [ADDRESS])).toEqual([
      {
        url: REPORT.url,
        claim: 'A forum user says this wallet drained their account.',
        quote: 'is a scam, it drained my account',
        date: '2026-10-02',
        matched: ADDRESS,
      },
    ]);
  });

  it('drops a report for a page that was never fetched', () => {
    expect(verifyReports(extraction({ url: 'https://evil.example/' }), sources, [ADDRESS])).toEqual(
      [],
    );
  });

  it('drops a report whose matched string is not the identifier', () => {
    expect(verifyReports(extraction({ matched: NEAR_MISS }), sources, [ADDRESS])).toEqual([]);
    expect(verifyReports(extraction({ matched: 'this wallet' }), sources, [ADDRESS])).toEqual([]);
  });

  it('drops a report when the page does not contain the identifier, whatever the model says', () => {
    const lying = extraction({ url: OTHER_WALLET.url, quote: 'is a scam and stole funds' });
    expect(verifyReports(lying, [OTHER_WALLET], [ADDRESS])).toEqual([]);
  });

  it('drops a quote that is not on the page', () => {
    const invented = extraction({ quote: 'this wallet belongs to a convicted fraudster' });
    expect(verifyReports(invented, sources, [ADDRESS])).toEqual([]);
  });

  it('drops pages the model says are not scam reports', () => {
    expect(verifyReports(extraction({ is_scam_report: false }), sources, [ADDRESS])).toEqual([]);
  });

  it('falls back to the page date and ignores a malformed one', () => {
    const [report] = verifyReports(extraction({ date: 'last week' }), sources, [ADDRESS]);
    expect(report!.date).toBe('2026-10-02');
  });
});

describe('extraction schema', () => {
  const valid = {
    reports: [
      {
        url: 'https://a.example',
        is_scam_report: true,
        claim: 'c',
        quote: 'a short quote',
        date: null,
        matched: ADDRESS,
      },
    ],
  };

  it('accepts a well-formed answer', () => {
    expect(extractionSchema.safeParse(valid).success).toBe(true);
    expect(extractionSchema.safeParse({ reports: [] }).success).toBe(true);
  });

  it('rejects malformed answers', () => {
    const report = valid.reports[0]!;
    const longQuote = Array.from({ length: MAX_QUOTE_WORDS + 1 }, () => 'word').join(' ');
    const malformed: unknown[] = [
      null,
      'no reports',
      {},
      { reports: {} },
      { reports: [{ ...report, quote: longQuote }] },
      { reports: [{ ...report, quote: '' }] },
      { reports: [{ ...report, is_scam_report: 'yes' }] },
      { reports: [{ ...report, matched: undefined }] },
      { reports: [{ ...report, date: 20261002 }] },
      { reports: [{ ...report, tier: 'FLAGGED' }] },
      { reports: [], windowSecs: 0 },
    ];
    for (const value of malformed) {
      expect(extractionSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });
});

describe('keyword extraction (no model)', () => {
  it('counts a page that names the identifier next to a scam term', () => {
    const reports = keywordReports([REPORT, NEUTRAL, OTHER_WALLET, NO_IDENTIFIER], [ADDRESS]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ url: REPORT.url, matched: ADDRESS, date: '2026-10-02' });
    expect(reports[0]!.quote).toContain(ADDRESS);
    expect(reports[0]!.quote.split(/\s+/).length).toBeLessThanOrEqual(MAX_QUOTE_WORDS);
  });

  it('understands scam terms in the other languages', () => {
    const es = page('https://foro.example/1', `Cuidado, ${ADDRESS} es una estafa.`);
    const pt = page('https://forum.example/pt', `Cuidado, ${ADDRESS} é golpe.`);
    const hi = page('https://forum.example/hi', `सावधान, ${ADDRESS} से ठगी हो रही है।`);
    expect(keywordReports([es, pt, hi], [ADDRESS])).toHaveLength(3);
  });
});

describe('extractReports', () => {
  const llmReturning = (answer: unknown): LlmClient => ({
    provider: 'anthropic',
    model: 'fixture',
    complete: async (request) => request.schema.parse(answer),
  });

  it('never asks the model when no page contains the identifier', async () => {
    let asked = false;
    const llm: LlmClient = {
      provider: 'anthropic',
      model: 'fixture',
      complete: async () => {
        asked = true;
        throw new Error('should not be called');
      },
    };
    expect(await extractReports(llm, [OTHER_WALLET, NO_IDENTIFIER], [ADDRESS])).toEqual([]);
    expect(asked).toBe(false);
  });

  it('uses a valid model answer, after checking it', async () => {
    const llm = llmReturning({
      reports: [
        {
          url: REPORT.url,
          is_scam_report: true,
          claim: 'The page says the wallet drained an account.',
          quote: 'it drained my account',
          date: null,
          matched: ADDRESS,
        },
        {
          url: NEUTRAL.url,
          is_scam_report: false,
          claim: 'The page lists the wallet as a token holder.',
          quote: 'Top holders this week',
          date: null,
          matched: ADDRESS,
        },
      ],
    });
    const reports = await extractReports(llm, [REPORT, NEUTRAL, OTHER_WALLET], [ADDRESS]);
    expect(reports.map((report) => report.url)).toEqual([REPORT.url]);
  });

  it('falls back to keywords when the model answer is malformed', async () => {
    const llm = llmReturning({ reports: [{ url: REPORT.url, verdict: 'scam' }] });
    const reports = await extractReports(llm, [REPORT, NEUTRAL], [ADDRESS]);
    expect(reports.map((report) => report.url)).toEqual([REPORT.url]);
    expect(reports[0]!.claim).toContain('near the word');
  });

  it('works with no model at all', async () => {
    const reports = await extractReports(null, [REPORT, NEUTRAL], [ADDRESS]);
    expect(reports.map((report) => report.url)).toEqual([REPORT.url]);
  });
});
