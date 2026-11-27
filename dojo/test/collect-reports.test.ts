import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collect, excerptOf, FirecrawlError, publishedDate } from '../scripts/collect-reports';

/**
 * The collector is exercised against a stand-in for Firecrawl's HTTP API that
 * answers in the documented v2 response shapes. No real request is made here.
 */
let directory: string;
let output: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dojo-collect-'));
  output = join(directory, 'data', 'reports.jsonl');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

const PAGE = [
  '# Warning about parcel texts',
  '',
  '[Skip to content](https://post.example/skip) ![logo](https://post.example/logo.png)',
  '',
  'This short line is navigation.',
  '',
  'People across the region report text messages that claim a parcel is held at customs and ask for a small release fee. The message is a scam and the link leads to a fake payment page.',
  '',
  "If you receive one, do not pay. Check the tracking number on the carrier's own website and report the fraud to the national helpline.",
].join('\n');

function fakeFirecrawl() {
  const requests: { url: string; authorization: string | null; body: Record<string, unknown> }[] =
    [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url, authorization: new Headers(init?.headers).get('authorization'), body });
    if (url.endsWith('/search')) {
      return Response.json({
        success: true,
        data: {
          web: [
            {
              url: 'https://post.example/parcel-warning',
              title: 'Parcel text warning',
              description: 'Warning about parcel texts.',
              markdown: PAGE,
              metadata: {
                sourceURL: 'https://post.example/parcel-warning',
                publishedTime: '2026-03-04T09:00:00Z',
              },
            },
            { url: 'https://empty.example/', title: 'Nothing', description: '', markdown: '' },
          ],
        },
        creditsUsed: 2,
      });
    }
    return Response.json({
      success: true,
      data: { markdown: PAGE, metadata: { title: 'Advisory', sourceURL: body.url } },
    });
  };
  return { fetcher, requests };
}

describe('collect', () => {
  it('searches, scrapes and writes one JSON line per page', async () => {
    const { fetcher, requests } = fakeFirecrawl();
    const result = await collect({
      apiKey: 'fc-test',
      output,
      fetch: fetcher,
      log: () => {},
      limit: 3,
      now: () => new Date('2026-11-27T10:00:00Z'),
      queries: [{ category: 'parcel_fee', query: 'parcel customs fee text scam' }],
      advisoryUrls: ['https://agency.example/advice'],
    });
    expect(result).toEqual({ added: 2, total: 2 });

    expect(requests).toEqual([
      {
        url: 'https://api.firecrawl.dev/v2/search',
        authorization: 'Bearer fc-test',
        body: {
          query: 'parcel customs fee text scam',
          limit: 3,
          sources: ['web'],
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        },
      },
      {
        url: 'https://api.firecrawl.dev/v2/scrape',
        authorization: 'Bearer fc-test',
        body: {
          url: 'https://agency.example/advice',
          formats: ['markdown'],
          onlyMainContent: true,
        },
      },
    ]);

    const lines = readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      {
        url: 'https://agency.example/advice',
        title: 'Advisory',
        date: null,
        collected_at: '2026-11-27T10:00:00.000Z',
        category: 'advisory',
        query: null,
        excerpt: expect.stringContaining('a parcel is held at customs'),
      },
      {
        url: 'https://post.example/parcel-warning',
        title: 'Parcel text warning',
        date: '2026-03-04',
        collected_at: '2026-11-27T10:00:00.000Z',
        category: 'parcel_fee',
        query: 'parcel customs fee text scam',
        excerpt: expect.stringContaining('The message is a scam'),
      },
    ]);
  });

  it('keeps pages it already has and does not scrape them again', async () => {
    const { fetcher, requests } = fakeFirecrawl();
    const options = {
      apiKey: 'fc-test',
      output,
      fetch: fetcher,
      log: () => {},
      queries: [{ category: 'parcel_fee', query: 'q' }],
      advisoryUrls: ['https://agency.example/advice'],
    };
    await collect(options);
    const firstFile = readFileSync(output, 'utf8');
    const second = await collect({ ...options, now: () => new Date('2027-01-01T00:00:00Z') });
    expect(second).toEqual({ added: 0, total: 2 });
    expect(readFileSync(output, 'utf8')).toBe(firstFile);
    expect(requests.filter((request) => request.url.endsWith('/scrape'))).toHaveLength(1);
  });

  it('skips a failed request but stops when the credits are spent', async () => {
    const logged: string[] = [];
    const failing: typeof fetch = async (input) =>
      String(input).endsWith('/search')
        ? Response.json({ success: false, error: 'Request timed out' }, { status: 408 })
        : Response.json({ success: false, error: 'Insufficient credits' }, { status: 402 });
    const run = collect({
      apiKey: 'fc-test',
      output,
      fetch: failing,
      log: (line) => logged.push(line),
      queries: [{ category: 'x', query: 'q' }],
      advisoryUrls: ['https://agency.example/advice'],
    });
    await expect(run).rejects.toThrow(FirecrawlError);
    await expect(run).rejects.toThrow('Insufficient credits');
    expect(logged).toEqual(['skipped search "q": Request timed out']);
  });

  it('never invents a date', () => {
    expect(publishedDate({ metadata: {} })).toBeNull();
    expect(publishedDate({ metadata: { publishedTime: 'last week' } })).toBeNull();
    expect(
      publishedDate({ metadata: { 'article:published_time': ['2025-08-01T12:00:00+05:30'] } }),
    ).toBe('2025-08-01');
    expect(publishedDate({ date: '2026-02-10' })).toBe('2026-02-10');
  });

  it('cuts long excerpts and falls back to the description', () => {
    const long = excerptOf({ markdown: `${'This is a scam warning. '.repeat(80)}` });
    expect(long.length).toBeLessThanOrEqual(700);
    expect(long.endsWith('…')).toBe(true);
    expect(excerptOf({ markdown: 'short', description: ' A short description. ' })).toBe(
      'A short description.',
    );
    expect(excerptOf({})).toBe('');
  });

  it('reads an existing file written by an earlier run', async () => {
    const { fetcher } = fakeFirecrawl();
    const earlier = {
      url: 'https://old.example/report',
      title: 'Old',
      date: null,
      collected_at: '2026-01-01T00:00:00.000Z',
      category: 'romance',
      query: 'q0',
      excerpt: 'An older excerpt.',
    };
    await collect({
      apiKey: 'k',
      output,
      fetch: fetcher,
      log: () => {},
      queries: [],
      advisoryUrls: [],
    });
    writeFileSync(output, `${JSON.stringify(earlier)}\n`);
    const result = await collect({
      apiKey: 'k',
      output,
      fetch: fetcher,
      log: () => {},
      queries: [{ category: 'parcel_fee', query: 'q' }],
      advisoryUrls: [],
    });
    expect(result).toEqual({ added: 1, total: 2 });
    expect(readFileSync(output, 'utf8')).toContain('https://old.example/report');
  });
});
