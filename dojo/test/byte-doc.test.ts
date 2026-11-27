import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BYTE_DOC_PATH,
  checkByteDoc,
  parseByteDoc,
  PLACEHOLDER_ORIGIN,
  PROSE_BUDGET,
  renderByteDoc,
} from '../scripts/byte-doc';
import { SCORE_THRESHOLDS } from '../scripts/simulate';
import { MOVES } from '../src/types';

const text = readFileSync(BYTE_DOC_PATH, 'utf8');
const { prose, manifest } = parseByteDoc(text);

describe('BYTE_GAME.md', () => {
  it('is consistent with the engine and the rules', () => {
    expect(checkByteDoc(text)).toEqual([]);
  });

  it('keeps the prose inside the prompt budget', () => {
    console.log(`BYTE_GAME.md prose: ${prose.length} characters`);
    expect(prose.length).toBeLessThanOrEqual(PROSE_BUDGET);
  });

  it('declares the closed move list, one action per move', () => {
    expect(manifest.api?.actions?.map((action) => action.name)).toEqual([...MOVES]);
    for (const action of manifest.api?.actions ?? []) {
      expect(action.method).toBe('POST');
      expect(action.path).toBe('/api/dojo/runs/{{dojoRun}}/moves');
      expect(action.description?.length).toBeGreaterThan(20);
    }
  });

  it('bets on thresholds that the simulations report', () => {
    const score = manifest.api?.bets?.find((bet) => bet.id === 'score');
    expect(score?.at).toEqual([...SCORE_THRESHOLDS]);
    expect(manifest.api?.bets?.map((bet) => bet.id)).toEqual(['wins', 'score', 'survives']);
  });

  it('catches a document that drifted from the rules', () => {
    expect(checkByteDoc(text.replace('at least 900 points', 'at least 500 points'))).toContain(
      'Prose is out of date on win score: expected "at least 900 points"',
    );
    expect(checkByteDoc(text.replace('"name": "report"', '"name": "flag"')).join('\n')).toContain(
      'actions must be exactly',
    );
    expect(checkByteDoc(text.replace('Bearer {{playToken}}', 'Bearer {{apiKey}}'))).toContain(
      'auth uses undefined {{apiKey}}',
    );
    expect(
      checkByteDoc(text.replace('"path": "rounds_survived"', '"path": "floor"')).join('\n'),
    ).toContain('"floor" is not a numeric state field');
  });

  it('renders with the deployed origin and refuses unusable ones', () => {
    const rendered = renderByteDoc(text, 'https://play.example.org');
    expect(rendered).not.toContain(PLACEHOLDER_ORIGIN);
    expect(parseByteDoc(rendered).manifest.api).toMatchObject({
      baseUrl: 'https://play.example.org',
      watchUrl: 'https://play.example.org/dojo/watch/{{dojoRun}}',
    });
    expect(checkByteDoc(rendered)).toEqual([]);
    for (const origin of ['http://play.example.org', 'https://localhost', 'https://x.org/api']) {
      expect(() => renderByteDoc(text, origin)).toThrow('public https origin');
    }
  });
});
