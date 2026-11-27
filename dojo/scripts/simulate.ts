/**
 * Plays many seeded runs with scripted players and prints how each one scores.
 *
 * This is where the balance is checked (blind strategies must lose to someone
 * who looks at the evidence) and where the bet thresholds in BYTE_GAME.md come
 * from. Run it with `npm run simulate --workspace dojo`.
 *
 * The scripted players are models, not people. "Informed" players read the
 * hidden signal of each revealed clue, which stands in for understanding the
 * text; the noisy ones then misjudge a share of rounds on purpose.
 */
import { applyMove, scenarioForRound, startRun } from '../src/engine';
import { createRng, type Rng } from '../src/rng';
import { RULES } from '../src/rules';
import type { DojoState, Move, Scenario, Signal } from '../src/types';

export interface PlayerView {
  state: DojoState;
  /** Ground truth of the current round. Blind players never look at it. */
  scenario: Scenario;
  /** Per-run randomness for players that make mistakes. */
  rng: Rng;
}

export type Player = (view: PlayerView) => Move;

/** Signals of the clues revealed so far this round, in order. */
function evidence({ state, scenario }: PlayerView): Signal[] {
  let question = 0;
  return state.revealed_clues.flatMap((clue) => {
    if (clue.source === 'identity') return [scenario.identity.signal];
    if (clue.source === 'question') return [scenario.clues[question++]?.signal ?? 'unclear'];
    return [];
  });
}

/** Checks the official channel first, asks questions while unsure, hedges if still unsure. */
const informed: Player = (view) => {
  if (view.state.revealed_clues.length === 0) return 'verify_identity';
  const signals = evidence(view);
  if (signals.includes('scam')) return 'report';
  if (signals.includes('legitimate')) return 'pay';
  return view.state.legal_moves.includes('ask_question') ? 'ask_question' : 'pay_with_holdback';
};

/** Asks one question and decides on it; hedges with the undo window when it says little. */
const oneQuestion: Player = (view) => {
  if (view.state.revealed_clues.length === 0) return 'ask_question';
  const [signal] = evidence(view);
  if (signal === 'scam') return 'refuse';
  return signal === 'legitimate' ? 'pay' : 'pay_with_holdback';
};

/** Reveals everything before deciding: always right, always slow. */
const exhaustive: Player = (view) => {
  const { legal_moves: legal } = view.state;
  if (legal.includes('ask_question')) return 'ask_question';
  if (legal.includes('verify_identity')) return 'verify_identity';
  return view.scenario.truth === 'scam' ? 'report' : 'pay';
};

/**
 * Like `informed`, but reaches the right conclusion only `accuracy` of the
 * time. A misjudged scam is paid, a misjudged honest request is refused.
 */
function noisy(accuracy: number): Player {
  return (view) => {
    const move = informed(view);
    if (move !== 'report' && move !== 'pay') return move;
    if (view.rng() < accuracy) return move;
    return move === 'report' ? 'pay' : 'refuse';
  };
}

export const PLAYERS: Record<string, Player> = {
  'always pay': () => 'pay',
  'always refuse': () => 'refuse',
  'always report': () => 'report',
  'always pay_with_holdback': () => 'pay_with_holdback',
  'coin flip pay/refuse': ({ rng }) => (rng() < 0.5 ? 'pay' : 'refuse'),
  'one question': oneQuestion,
  exhaustive,
  'informed, 70% accurate': noisy(0.7),
  'informed, 80% accurate': noisy(0.8),
  'informed, 90% accurate': noisy(0.9),
  informed,
};

/** Plays one run to the end and returns the final state. */
export function playRun(seed: string, player: Player): DojoState {
  const rng = createRng(`${seed}:player`);
  let state = startRun({ runId: seed, seed });
  while (!state.done) {
    const scenario = scenarioForRound(seed, state.round);
    const outcome = applyMove(state, seed, player({ state, scenario, rng }), state.turn);
    if (!outcome.applied) throw new Error(`Scripted player made an illegal move: ${outcome.error}`);
    state = outcome.state;
  }
  return state;
}

export interface Summary {
  player: string;
  runs: number;
  mean: number;
  p10: number;
  median: number;
  p90: number;
  min: number;
  max: number;
  /** Share of runs, in percent. */
  won: number;
  survived_all_rounds: number;
  /** Share of runs whose final score reached each threshold, in percent. */
  reached: Record<number, number>;
  mean_moves: number;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

function percent(count: number, total: number): number {
  return Math.round((count / total) * 1000) / 10;
}

export const SCORE_THRESHOLDS = [600, 800, 900, 1000, 1100] as const;

export function summarise(name: string, runs: number, seedPrefix = 'sim'): Summary {
  const player = PLAYERS[name];
  if (!player) throw new Error(`Unknown player ${name}`);
  const finals = Array.from({ length: runs }, (_, i) => playRun(`${seedPrefix}-${i}`, player));
  const scores = finals.map((state) => state.score).sort((a, b) => a - b);
  const total = scores.reduce((sum, score) => sum + score, 0);
  return {
    player: name,
    runs,
    mean: Math.round(total / runs),
    p10: percentile(scores, 0.1),
    median: percentile(scores, 0.5),
    p90: percentile(scores, 0.9),
    min: scores[0] ?? 0,
    max: scores[scores.length - 1] ?? 0,
    won: percent(finals.filter((state) => state.status === 'won').length, runs),
    survived_all_rounds: percent(
      finals.filter((state) => state.rounds_survived === RULES.maxRounds).length,
      runs,
    ),
    reached: Object.fromEntries(
      SCORE_THRESHOLDS.map((threshold) => [
        threshold,
        percent(scores.filter((score) => score >= threshold).length, runs),
      ]),
    ),
    mean_moves: Math.round((finals.reduce((sum, s) => sum + s.turn, 0) / runs) * 10) / 10,
  };
}

export function summariseAll(runs: number): Summary[] {
  return Object.keys(PLAYERS).map((name) => summarise(name, runs));
}

/** The summaries as a Markdown table, the form used in the README. */
export function toMarkdown(summaries: Summary[]): string {
  const header = [
    'player',
    'mean',
    'p10',
    'median',
    'p90',
    'max',
    'won %',
    'survived 8 %',
    ...SCORE_THRESHOLDS.map((threshold) => `≥${threshold} %`),
    'moves',
  ];
  const rows = summaries.map((s) => [
    s.player,
    s.mean,
    s.p10,
    s.median,
    s.p90,
    s.max,
    s.won,
    s.survived_all_rounds,
    ...SCORE_THRESHOLDS.map((threshold) => s.reached[threshold]),
    s.mean_moves,
  ]);
  return [header, header.map(() => '---'), ...rows]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');
}

if (require.main === module) {
  const runs = Number(process.argv[2] ?? 2000);
  console.log(`Scripted players over ${runs} seeded runs each (seeds sim-0 … sim-${runs - 1}).\n`);
  console.log(toMarkdown(summariseAll(runs)));
}
