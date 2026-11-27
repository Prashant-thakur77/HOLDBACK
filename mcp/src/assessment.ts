/** The part of a Guardian assessment that tools hand back to the calling model. */
import { formatDuration, type AssessResponse } from '@holdback/sdk';
import { z } from 'zod';

import { tier } from './schemas';

const TOP_FINDINGS = 5;

const finding = z.object({
  title: z.string(),
  level: z.enum(['info', 'warning', 'critical']),
  points: z.number().describe('Points this finding added to the risk score.'),
  sources: z.array(
    z.object({
      source: z.string().describe('Which collector observed it.'),
      detail: z.string(),
      url: z.string().nullable().describe('Where a person can check it.'),
      quote: z.string().nullable(),
    }),
  ),
});

export const assessmentShape = {
  tier,
  score: z.number().describe('Risk score; higher is riskier.'),
  windowSecs: z.number().describe('Undo window the policy assigns, in seconds. 0 = instant.'),
  window: z.string().describe('The same window in words.'),
  topFindings: z
    .array(finding)
    .describe(`Up to ${TOP_FINDINGS} findings, strongest first, each with its sources.`),
  explanation: z.string().describe('Two or three plain sentences citing the strongest evidence.'),
  evidenceHash: z
    .string()
    .describe('Hex sha256 of the full evidence document. It is written on-chain with the hold.'),
  unavailableSources: z
    .array(z.string())
    .describe('Evidence sources that did not answer in time. They added no points.'),
};

export type AssessmentSummary = z.infer<z.ZodObject<typeof assessmentShape>>;

export function summarize(assessment: AssessResponse): AssessmentSummary {
  const topFindings = [...assessment.findings]
    .sort((a, b) => b.points - a.points)
    .slice(0, TOP_FINDINGS)
    .map(({ title, level, points, evidence }) => ({
      title,
      level,
      points,
      sources: evidence.flatMap((index) => {
        const item = assessment.evidence[index];
        if (!item) return [];
        const { source, detail, url, quote } = item;
        return [{ source, detail, url: url ?? null, quote: quote ?? null }];
      }),
    }));
  return {
    tier: assessment.tier,
    score: assessment.score,
    windowSecs: assessment.windowSecs,
    window: assessment.windowSecs === 0 ? 'instant' : formatDuration(assessment.windowSecs),
    topFindings,
    explanation: assessment.spoken.text,
    evidenceHash: assessment.evidenceHash,
    unavailableSources: assessment.unavailable,
  };
}
