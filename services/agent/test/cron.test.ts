import { describe, expect, it } from 'vitest';

import { CRON_EVERY_MINUTE, CRON_HOURLY, CRON_REASSESS, jobsFor } from '../src/cron';

const at = (iso: string) => Date.parse(iso);

describe('jobsFor', () => {
  it('runs only the minute job on an ordinary minute', () => {
    expect(jobsFor(CRON_EVERY_MINUTE, at('2026-11-27T10:07:00Z'))).toEqual(['minute']);
  });

  it('adds the re-assessment every ten minutes', () => {
    expect(jobsFor(CRON_EVERY_MINUTE, at('2026-11-27T10:20:00Z'))).toEqual(['minute', 'reassess']);
  });

  it('adds the list refresh on the hour', () => {
    expect(jobsFor(CRON_EVERY_MINUTE, at('2026-11-27T11:00:00Z'))).toEqual([
      'minute',
      'reassess',
      'hourly',
    ]);
  });

  it('keeps dedicated triggers to their own job', () => {
    expect(jobsFor(CRON_REASSESS, at('2026-11-27T11:00:00Z'))).toEqual(['reassess']);
    expect(jobsFor(CRON_HOURLY, at('2026-11-27T11:00:00Z'))).toEqual(['hourly']);
  });
});
