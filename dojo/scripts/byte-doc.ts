/**
 * Checks BYTE_GAME.md against the engine and prints the version to upload.
 *
 *   npm run byte:doc --workspace dojo                         # check only
 *   npm run byte:doc --workspace dojo -- https://your.site    # print the upload text
 *
 * The document in the repo uses a placeholder origin; the real one is only
 * known after the web app is deployed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { startRun } from '../src/engine';
import { RULES } from '../src/rules';
import { DECISIONS, MOVES } from '../src/types';

export const PLACEHOLDER_ORIGIN = 'https://holdback.example';
export const BYTE_DOC_PATH = join(__dirname, '..', 'BYTE_GAME.md');

/** The prose enters the playing agent's prompt on every step and is cut off at this length. */
export const PROSE_HARD_LIMIT = 4_000;
/** The game spec asks for about 2000 useful characters; this allows a little slack. */
export const PROSE_BUDGET = 2_200;
const MAX_BET_EVENTS = 8;
const MAX_BET_VALUES = 6;
const MAX_SCORE_LABEL = 12;
/** Variables the platform defines by itself. */
const BUILT_IN_VARIABLES = ['callsign', 'runId'];

interface Call {
  method?: string;
  path?: string;
  body?: Record<string, unknown>;
}

interface Action extends Call {
  name?: string;
  description?: string;
  params?: Record<string, { type?: string; required?: boolean; choices?: unknown[] }>;
  decision?: boolean;
}

interface Bet {
  id?: string;
  type?: string;
  path?: string;
  at?: number[];
  within?: number[];
}

interface Manifest {
  name?: string;
  api?: {
    baseUrl?: string;
    start?: Call & { save?: Record<string, string> };
    auth?: { header?: string; value?: string };
    state?: Call;
    actions?: Action[];
    finish?: { path?: string; equals?: unknown[] };
    result?: {
      win?: { path?: string; equals?: unknown[] };
      score?: { path?: string; label?: string };
    };
    watchUrl?: string;
    bets?: Bet[];
  };
}

export interface ByteDoc {
  prose: string;
  manifest: Manifest;
}

const FENCE = /```json\n([\s\S]*?)\n```/;

export function parseByteDoc(text: string): ByteDoc {
  const match = FENCE.exec(text);
  if (!match?.[1]) throw new Error('The document has no ```json block');
  return {
    prose: text.replace(FENCE, '').trim(),
    manifest: JSON.parse(match[1]) as Manifest,
  };
}

function variablesIn(value: unknown): string[] {
  return [...JSON.stringify(value ?? '').matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '');
}

/** Everything wrong with the document, in words. An empty list means it is ready. */
export function checkByteDoc(text: string): string[] {
  const problems: string[] = [];
  const { prose, manifest } = parseByteDoc(text);
  const api = manifest.api;
  if (!api) return ['The JSON block has no "api" key'];

  if (prose.length > PROSE_BUDGET) {
    problems.push(
      `Prose is ${prose.length} characters; the budget is ${PROSE_BUDGET} and it is truncated at ${PROSE_HARD_LIMIT}`,
    );
  }
  if (!api.baseUrl?.startsWith('https://')) problems.push('baseUrl must be a public https origin');
  if (!api.watchUrl?.startsWith('https://')) problems.push('watchUrl must be https');

  const saved = Object.keys(api.start?.save ?? {});
  const sample = startRun({ runId: 'sample', seed: 'sample' }) as unknown as Record<
    string,
    unknown
  >;
  for (const [name, field] of Object.entries(api.start?.save ?? {})) {
    if (field !== 'play_token' && !(field in sample)) {
      problems.push(`start.save.${name} reads "${field}", which the start response does not have`);
    }
  }

  const shared = [...BUILT_IN_VARIABLES, ...saved];
  for (const [where, value] of Object.entries({
    start: api.start,
    auth: api.auth,
    state: api.state,
    watchUrl: api.watchUrl,
  })) {
    for (const variable of variablesIn(value)) {
      if (!shared.includes(variable)) problems.push(`${where} uses undefined {{${variable}}}`);
    }
  }

  const actions = api.actions ?? [];
  const names = actions.map((action) => action.name);
  if (JSON.stringify(names) !== JSON.stringify(MOVES)) {
    problems.push(`actions must be exactly ${MOVES.join(', ')} (found ${names.join(', ')})`);
  }
  for (const action of actions) {
    const allowed = [...shared, ...Object.keys(action.params ?? {})];
    for (const variable of variablesIn([action.path, action.body])) {
      if (!allowed.includes(variable)) {
        problems.push(`action ${action.name} uses undefined {{${variable}}}`);
      }
    }
    if (action.body?.move !== action.name)
      problems.push(`action ${action.name} sends another move`);
    if (action.body?.turn !== '{{turn}}' || action.params?.turn?.required !== true) {
      problems.push(`action ${action.name} must require and send turn`);
    }
    const commits = (DECISIONS as readonly string[]).includes(action.name ?? '');
    if (Boolean(action.decision) !== commits) {
      problems.push(`action ${action.name}: "decision" must be set on decisions only`);
    }
  }

  if (api.finish?.path !== 'status' || String(api.finish.equals) !== 'won,lost') {
    problems.push('finish must match status won or lost');
  }
  if (api.result?.win?.path !== 'status' || String(api.result.win.equals) !== 'won') {
    problems.push('result.win must match status won');
  }
  const scoreLabel = api.result?.score?.label ?? '';
  if (api.result?.score?.path !== 'score' || scoreLabel.length > MAX_SCORE_LABEL) {
    problems.push(
      `result.score must read "score" with a label of at most ${MAX_SCORE_LABEL} chars`,
    );
  }

  const bets = api.bets ?? [];
  if (bets.length > MAX_BET_EVENTS) problems.push(`At most ${MAX_BET_EVENTS} bets are allowed`);
  if (new Set(bets.map((bet) => bet.id)).size !== bets.length)
    problems.push('Bet ids must be unique');
  for (const bet of bets) {
    if (!/^[a-z0-9_-]+$/.test(bet.id ?? ''))
      problems.push(`Bet id "${bet.id}" has invalid characters`);
    if (bet.type === 'win') continue;
    if (bet.type !== 'reach') {
      problems.push(`Bet ${bet.id}: type ${bet.type} needs a shared world this game does not have`);
      continue;
    }
    if (typeof sample[bet.path ?? ''] !== 'number') {
      problems.push(`Bet ${bet.id}: "${bet.path}" is not a numeric state field`);
    }
    const values = bet.at ?? [];
    if (values.length === 0 || values.length > MAX_BET_VALUES) {
      problems.push(`Bet ${bet.id}: "at" needs 1 to ${MAX_BET_VALUES} values`);
    }
  }

  // The numbers in the prose are hand-written; make sure they still match the rules.
  const facts: [string, string][] = [
    ['win score', `at least ${RULES.winScore} points`],
    ['round count', `all ${RULES.maxRounds} rounds`],
    ['round points', `starts at ${RULES.roundPoints}`],
    ['question cost', `\`ask_question\` -${RULES.investigationCost.ask_question}`],
    ['identity cost', `\`verify_identity\` -${RULES.investigationCost.verify_identity}`],
    ['address cost', `\`check_address\` -${RULES.investigationCost.check_address}`],
    ['report bonus', `+${RULES.reportBonus}`],
    ['lives', `${RULES.startingLives} lives`],
  ];
  for (const [name, expected] of facts) {
    if (!prose.includes(expected))
      problems.push(`Prose is out of date on ${name}: expected "${expected}"`);
  }
  return problems;
}

/** The document with the placeholder origin replaced by the deployed site's origin. */
export function renderByteDoc(text: string, origin: string): string {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.hostname === 'localhost') {
    throw new Error('Pass the public https origin of the deployed site, e.g. https://your.site');
  }
  return text.split(PLACEHOLDER_ORIGIN).join(url.origin);
}

if (require.main === module) {
  const text = readFileSync(BYTE_DOC_PATH, 'utf8');
  const problems = checkByteDoc(text);
  if (problems.length > 0) {
    console.error(problems.map((problem) => `- ${problem}`).join('\n'));
    process.exit(1);
  }
  const origin = process.argv[2];
  if (origin) {
    process.stdout.write(renderByteDoc(text, origin));
  } else {
    const { prose } = parseByteDoc(text);
    console.log(
      `BYTE_GAME.md is consistent with the engine. Prose: ${prose.length} characters (budget ${PROSE_BUDGET}, truncated at ${PROSE_HARD_LIMIT}).`,
    );
  }
}
