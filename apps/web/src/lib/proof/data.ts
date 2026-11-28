/**
 * The devnet proofs for the "Try to rob it" page.
 *
 * `next.config.ts` reads `proofs/devnet.json` and `proofs/build.json` at build
 * time and compiles their text into the server bundle. Every count, error
 * name, signature and hash on the page comes from those two files; a missing
 * or unreadable file yields `null` and the page says so.
 */
import { z } from 'zod';

const proofSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['happy path', 'attack']),
  description: z.string(),
  expected: z.string(),
  outcome: z.string(),
  error: z.string().nullable(),
  signature: z.string().min(32),
  explorer: z.string().url(),
});

const reportSchema = z.object({
  generated_at: z.string(),
  cluster: z.string(),
  program: z.string().min(32),
  counts: z.object({
    happy_paths: z.number().int().nonnegative(),
    attacks_refused: z.number().int().nonnegative(),
  }),
  proofs: z.array(proofSchema),
});

const buildSchema = z.object({
  program_hash: z.string().regex(/^[0-9a-f]{64}$/),
  base_image: z.string(),
  commit: z.string(),
});

export type Proof = z.infer<typeof proofSchema>;
export type ProofReport = z.infer<typeof reportSchema>;
export type ProgramBuild = z.infer<typeof buildSchema>;

function parse<T>(schema: z.ZodType<T>, text: string | undefined): T | null {
  if (!text) return null;
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function parseProofReport(text: string | undefined): ProofReport | null {
  return parse(reportSchema, text);
}

export function parseProgramBuild(text: string | undefined): ProgramBuild | null {
  return parse(buildSchema, text);
}

/** Who is attempting the attack. Told from the proof's own description. */
export type Attacker = 'stranger' | 'relayer' | 'oracle' | 'sender' | 'impostor';

export const ATTACKERS: { key: Attacker; title: string; text: string }[] = [
  {
    key: 'stranger',
    title: 'A stranger',
    text: 'Someone with no role in the payment tries to move it, close it or sign as someone else.',
  },
  {
    key: 'relayer',
    title: 'The relayer key',
    text: 'The service key for deposit boxes tries to pay itself, release early or cut the window.',
  },
  {
    key: 'oracle',
    title: 'The oracle key',
    text: 'The risk oracle may lengthen a window. Here it tries to shorten one.',
  },
  {
    key: 'sender',
    title: 'The sender',
    text: 'The person who paid tries to undo twice, undo too late, or skip the rules.',
  },
  {
    key: 'impostor',
    title: 'An impostor signing assessments',
    text: 'Attested holds carry the risk oracle’s signature. These forge it, alter what was signed, or leave it out.',
  },
];

/**
 * Sorts an attack under whoever attempts it. Attacks on the signed assessment
 * come first, because their descriptions also mention the oracle or the
 * sender; anything not attempted with a named key is a stranger's.
 */
export function attackerOf(proof: Pick<Proof, 'description'>): Attacker {
  const text = proof.description;
  if (/assessment|attested|oracle signed|oracle[’']s signature/i.test(text)) return 'impostor';
  if (/^The relayer\b/.test(text)) return 'relayer';
  if (/^The oracle\b/.test(text)) return 'oracle';
  if (/^The sender\b|the sender never trusted|^The same reporter\b/.test(text)) return 'sender';
  return 'stranger';
}

export function proofReport(): ProofReport | null {
  return parseProofReport(process.env.PROOFS_DEVNET);
}

export function programBuild(): ProgramBuild | null {
  return parseProgramBuild(process.env.PROOFS_BUILD);
}
