import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LANGS, type EvidenceDocument, type Lang } from '@holdback/sdk';

import { parseModelJson, type LlmClient } from '../src/llm/client';
import { OPENERS, RULE_PHRASES, spokenDuration } from '../src/llm/phrases';
import {
  isAcceptable,
  sentenceCount,
  spokenExplanation,
  spokenSchema,
  templateSpoken,
} from '../src/llm/spoken';
import { POLICY_VERSION, RULES, decide } from '../src/policy';
import type { Signal } from '../src/signals';

function documentFor(signals: Signal[], unavailable: string[] = []): EvidenceDocument {
  const decision = decide(signals);
  return {
    policyVersion: POLICY_VERSION,
    assessedAt: '2026-11-27T00:00:00.000Z',
    sender: 's',
    recipient: 'r',
    mint: 'SOL',
    amount: '1',
    score: decision.score,
    tier: decision.tier,
    windowSecs: decision.windowSecs,
    findings: decision.findings,
    evidence: decision.evidence,
    unavailable,
  };
}

const signal = (id: string, value?: number): Signal => {
  const [source, name] = id.split('.') as [Signal['source'], string];
  return { source, signal: name, detail: `fixture ${id}`, value };
};

describe('parseModelJson', () => {
  const schema = z.strictObject({ text: z.string().min(3) });

  it('parses plain and fenced JSON', () => {
    expect(parseModelJson('{"text":"hello"}', schema)).toEqual({ text: 'hello' });
    expect(parseModelJson('```json\n{"text":"hello"}\n```', schema)).toEqual({ text: 'hello' });
    expect(parseModelJson('  {"text":"hello"}\n', schema)).toEqual({ text: 'hello' });
  });

  it('throws on anything malformed', () => {
    const malformed = [
      '',
      'Sure! Here is the JSON: {"text":"hello"}',
      '{"text":"hello"',
      '{"text":42}',
      '{"text":"hi"}',
      '{"text":"hello","tier":"TRUSTED"}',
      '[{"text":"hello"}]',
      'null',
      '{"TEXT":"hello"}',
    ];
    for (const text of malformed) {
      expect(() => parseModelJson(text, schema), text).toThrow();
    }
  });
});

describe('spoken duration', () => {
  it('speaks the tier windows naturally in each language', () => {
    expect(spokenDuration(1800, 'en')).toBe('30 minutes');
    expect(spokenDuration(21600, 'en')).toBe('6 hours');
    expect(spokenDuration(86400, 'en')).toBe('24 hours');
    expect(spokenDuration(259200, 'en')).toBe('3 days');
    expect(spokenDuration(3600, 'en')).toBe('1 hour');
    expect(spokenDuration(45, 'en')).toBe('1 minute');
    expect(spokenDuration(21600, 'hi')).toBe('6 घंटे');
    expect(spokenDuration(259200, 'es')).toBe('3 días');
    expect(spokenDuration(1800, 'pt')).toBe('30 minutos');
  });
});

describe('template explanation', () => {
  const scoredRules = Object.entries(RULES)
    .filter(([, rule]) => rule.points > 0)
    .map(([id]) => id);

  it('has words for every rule that adds risk, in every language', () => {
    for (const id of scoredRules) {
      expect(RULE_PHRASES[id], id).toBeDefined();
      for (const lang of LANGS)
        expect(RULE_PHRASES[id]![lang].length, `${id} ${lang}`).toBeGreaterThan(5);
    }
  });

  it('passes its own acceptance rules for every rule and language', () => {
    for (const id of scoredRules) {
      const document = documentFor([signal(id, 1)]);
      for (const lang of LANGS) {
        const text = templateSpoken(document, lang);
        expect(isAcceptable(text, lang), `${id} ${lang}: ${text}`).toBe(true);
      }
    }
  });

  it('passes its own acceptance rules for every opener', () => {
    const cases: [string, EvidenceDocument][] = [
      ['clean', documentFor([])],
      ['unchecked', documentFor([], ['helius', 'blocklist', 'chainabuse', 'web_reports', 'sns'])],
      ['trusted account', documentFor([signal('onchain_reputation.trust_account')])],
      [
        'trusted history',
        documentFor([
          signal('baseline.released_to_recipient', 4),
          signal('onchain_reputation.no_onchain_flags'),
          signal('onchain_reputation.no_offchain_flags'),
        ]),
      ],
      ['sanctioned', documentFor([signal('blocklist.ofac_sanctioned')])],
    ];
    for (const [name, document] of cases) {
      for (const lang of LANGS) {
        const text = templateSpoken(document, lang);
        expect(isAcceptable(text, lang), `${name} ${lang}: ${text}`).toBe(true);
      }
    }
  });

  it('cites the strongest finding and the window', () => {
    const document = documentFor([
      signal('context.urgency'),
      signal('chainabuse.confirmed_reports'),
      signal('helius.wallet_new_7d'),
    ]);
    const text = templateSpoken(document, 'en');
    expect(text).toContain('Chainabuse');
    expect(text).toContain('24 hours');
    expect(text).toContain('undo');
    expect(sentenceCount(text)).toBe(3);
  });

  it('says "no warning signs found", never "safe", when nothing was found', () => {
    const text = templateSpoken(documentFor([]), 'en');
    expect(text).toContain('No warning signs found');
    expect(text).toContain('30 minutes');
    expect(text.toLowerCase()).not.toContain('safe');
  });

  it('does not claim a clean result when most checks did not run', () => {
    const text = templateSpoken(
      documentFor([], ['helius', 'blocklist', 'chainabuse', 'web_reports']),
      'en',
    );
    expect(text).toBe(
      `${OPENERS.unchecked.en} Your money is held for 30 minutes, and you can undo the payment at any time before then.`,
    );
  });

  it('writes Hindi in Devanagari and the others in Latin script', () => {
    const document = documentFor([signal('sns.lookalike_name')]);
    expect(templateSpoken(document, 'hi')).toMatch(/[ऀ-ॿ]/);
    for (const lang of ['en', 'es', 'pt'] as Lang[]) {
      expect(templateSpoken(document, lang)).not.toMatch(/[ऀ-ॿ]/);
    }
  });
});

describe('acceptance rules for model-written text', () => {
  const good =
    'I found warning signs about this recipient. There are scam reports about this address on Chainabuse. Your money is held for 24 hours, and you can undo the payment at any time.';

  it('accepts a calm, cited, two or three sentence explanation', () => {
    expect(isAcceptable(good, 'en')).toBe(true);
  });

  it('rejects text that calls the payment safe', () => {
    expect(
      isAcceptable('This recipient looks safe. Your money is held for 30 minutes anyway.', 'en'),
    ).toBe(false);
    expect(
      isAcceptable(
        'Este destinatario es seguro. Tu dinero queda retenido 30 minutos de todos modos.',
        'es',
      ),
    ).toBe(false);
    expect(
      isAcceptable(
        'Este destinatário é seguro. Seu dinheiro fica retido por 30 minutos mesmo assim.',
        'pt',
      ),
    ).toBe(false);
    expect(
      isAcceptable('यह प्राप्तकर्ता सुरक्षित है। आपका पैसा फिर भी 30 मिनट तक रोका गया है।', 'hi'),
    ).toBe(false);
  });

  it('rejects text that tells the user to pay', () => {
    expect(
      isAcceptable(
        'No warning signs were found for this recipient. You can send the money now.',
        'en',
      ),
    ).toBe(false);
    expect(
      isAcceptable('No warning signs were found here. Go ahead, the hold lasts 30 minutes.', 'en'),
    ).toBe(false);
    expect(
      isAcceptable(
        'No se encontraron señales de alerta. Puedes enviar el dinero ahora mismo.',
        'es',
      ),
    ).toBe(false);
    expect(
      isAcceptable(
        'Nenhum sinal de alerta foi encontrado. Você pode enviar o dinheiro agora.',
        'pt',
      ),
    ).toBe(false);
    expect(isAcceptable('कोई चेतावनी संकेत नहीं मिला। आप पैसे भेज सकते हैं।', 'hi')).toBe(false);
  });

  it('rejects the wrong length, sentence count or script', () => {
    expect(isAcceptable('Held for 24 hours.', 'en')).toBe(false);
    expect(isAcceptable(`${good} One more. And another one here.`, 'en')).toBe(false);
    expect(isAcceptable('x'.repeat(600), 'en')).toBe(false);
    expect(isAcceptable(good, 'hi')).toBe(false);
    expect(isAcceptable(templateSpoken(documentFor([]), 'hi'), 'en')).toBe(false);
  });

  it('validates the answer shape strictly', () => {
    expect(spokenSchema.safeParse({ text: good }).success).toBe(true);
    for (const value of [
      {},
      { text: '' },
      { text: 5 },
      { text: good, tier: 'TRUSTED' },
      good,
      null,
    ]) {
      expect(spokenSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });
});

describe('spokenExplanation', () => {
  const risky = documentFor([signal('chainabuse.confirmed_reports')]);
  const llm = (answer: unknown): LlmClient => ({
    provider: 'anthropic',
    model: 'fixture',
    complete: async (request) => request.schema.parse(answer),
  });

  it('uses an acceptable model answer', async () => {
    const text =
      'Chainabuse has scam reports about this address. Your money is held for 24 hours, and you can undo the payment during that time.';
    expect(await spokenExplanation(llm({ text }), risky, 'en')).toBe(text);
  });

  it('falls back to the template when the model breaks a rule', async () => {
    const text = 'This recipient is probably safe. You can send the money whenever you like.';
    expect(await spokenExplanation(llm({ text }), risky, 'en')).toBe(templateSpoken(risky, 'en'));
  });

  it('falls back to the template when the model answer is malformed or fails', async () => {
    expect(await spokenExplanation(llm({ message: 'hi' }), risky, 'en')).toBe(
      templateSpoken(risky, 'en'),
    );
    const failing: LlmClient = {
      provider: 'openai',
      model: 'fixture',
      complete: async () => {
        throw new Error('timeout');
      },
    };
    expect(await spokenExplanation(failing, risky, 'pt')).toBe(templateSpoken(risky, 'pt'));
  });

  it('does not ask the model when there is nothing to cite', async () => {
    let asked = false;
    const spy: LlmClient = {
      provider: 'anthropic',
      model: 'fixture',
      complete: async () => {
        asked = true;
        throw new Error('unexpected');
      },
    };
    const clean = documentFor([]);
    expect(await spokenExplanation(spy, clean, 'es')).toBe(templateSpoken(clean, 'es'));
    expect(asked).toBe(false);
  });

  it('uses the template with no model configured', async () => {
    expect(await spokenExplanation(null, risky, 'hi')).toBe(templateSpoken(risky, 'hi'));
  });
});
