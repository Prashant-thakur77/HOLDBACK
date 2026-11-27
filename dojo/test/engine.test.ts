import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  applyMove,
  attachMemo,
  canonicalHistory,
  memoText,
  revealRounds,
  scenarioForRound,
  startRun,
} from '../src/engine';
import { DECISION_RULES, RULES } from '../src/rules';
import {
  DECISIONS,
  MOVES,
  type AddressCheck,
  type Decision,
  type DojoState,
  type Move,
} from '../src/types';

/** Applies moves in order, each with the correct turn, and fails on any rejection. */
function play(seed: string, moves: Move[], state = startRun({ runId: seed, seed })): DojoState {
  for (const move of moves) {
    const outcome = applyMove(state, seed, move, state.turn);
    expect(outcome.error, `${move} at turn ${state.turn}`).toBeNull();
    state = outcome.state;
  }
  return state;
}

/** The decision that is right for the current round. */
function rightCall(seed: string, state: DojoState): Decision {
  return scenarioForRound(seed, state.round).truth === 'scam' ? 'refuse' : 'pay';
}

function wrongCall(seed: string, state: DojoState): Decision {
  return scenarioForRound(seed, state.round).truth === 'scam' ? 'pay' : 'refuse';
}

function playWith(seed: string, choose: (state: DojoState) => Move): DojoState {
  let state = startRun({ runId: seed, seed });
  while (!state.done) state = play(seed, [choose(state)], state);
  return state;
}

/** First seed (by index) whose round-one scenario has the wanted truth. */
function seedStartingWith(truth: 'scam' | 'legitimate'): string {
  for (let i = 0; ; i++) {
    if (scenarioForRound(`first-${i}`, 1).truth === truth) return `first-${i}`;
  }
}

describe('startRun', () => {
  it('opens round one with the full starting state', () => {
    const state = startRun({ runId: 'run-a', seed: 'seed-a', player: 'byte' });
    expect(state).toMatchObject({
      run_id: 'run-a',
      player: 'byte',
      status: 'playing',
      done: false,
      turn: 0,
      round: 1,
      max_rounds: RULES.maxRounds,
      lives: RULES.startingLives,
      score: 0,
      wallet: RULES.startingWallet,
      points_available: RULES.roundPoints,
      legal_moves: [...MOVES],
      history: [],
      result: null,
      last_round: null,
    });
    expect(state.money_at_risk).toBe(state.scenario?.ask.amount);
  });

  it('never shows the answer of the round being played', () => {
    for (let i = 0; i < 50; i++) {
      const seed = `leak-${i}`;
      const scenario = scenarioForRound(seed, 1);
      const state = play(
        seed,
        ['ask_question', 'verify_identity', 'check_address'],
        startRun({ runId: 'public-run-id', seed }),
      );
      const visible = JSON.stringify(state);
      expect(visible).not.toContain(scenario.id);
      expect(visible).not.toContain(scenario.lesson);
      expect(visible).not.toContain('"signal"');
      expect(visible).not.toContain(seed);
    }
  });
});

describe('determinism', () => {
  it('produces the same states for the same seed and moves', () => {
    const script: Move[] = [
      'ask_question',
      'verify_identity',
      'refuse',
      'pay',
      'check_address',
      'report',
    ];
    const first = play('same-seed', script);
    const second = play('same-seed', script);
    expect(second).toEqual(first);
    expect(play('other-seed', script)).not.toEqual(first);
  });
});

describe('investigations', () => {
  it('reveal clues in ladder order and lower what the round is worth', () => {
    const seed = 'ladder';
    const scenario = scenarioForRound(seed, 1);
    let state = startRun({ runId: seed, seed });
    scenario.clues.forEach((clue, index) => {
      state = play(seed, ['ask_question'], state);
      expect(state.revealed_clues[index]).toEqual({ source: 'question', text: clue.text });
      expect(state.points_available).toBe(
        RULES.roundPoints - (index + 1) * RULES.investigationCost.ask_question,
      );
    });
    expect(state.legal_moves).not.toContain('ask_question');
    expect(state.score).toBe(0);

    const rejected = applyMove(state, seed, 'ask_question', state.turn);
    expect(rejected.applied).toBe(false);
    expect(rejected.error).toContain('every clue for this request is already revealed');
    expect(rejected.state).toBe(state);
  });

  it('allow one identity check and one address check per round', () => {
    const seed = 'once';
    const state = play(seed, ['verify_identity', 'check_address']);
    expect(state.legal_moves).not.toContain('verify_identity');
    expect(state.legal_moves).not.toContain('check_address');
    expect(state.revealed_clues[0]).toEqual({
      source: 'identity',
      text: scenarioForRound(seed, 1).identity.text,
    });
    expect(applyMove(state, seed, 'verify_identity', state.turn).error).toContain(
      'already checked',
    );

    const nextRound = play(seed, ['refuse'], state);
    expect(nextRound.legal_moves).toEqual([...MOVES]);
    expect(nextRound.revealed_clues).toEqual([]);
    expect(nextRound.points_available).toBe(RULES.roundPoints);
  });

  it('show the agent verdict for check_address and charge for it', () => {
    const seed = 'verdict';
    const check: AddressCheck = {
      available: true,
      tier: 'SUSPICIOUS',
      score: 42,
      window_secs: 21_600,
      summary: `  Two   reports mention this address.  ${'x'.repeat(600)}`,
    };
    const { state } = applyMove(startRun({ runId: seed, seed }), seed, 'check_address', 0, check);
    const clue = state.revealed_clues[0];
    expect(clue?.source).toBe('address');
    expect(clue?.text).toContain('tier SUSPICIOUS, risk score 42, undo window 6 h.');
    expect(clue?.text).toContain('Two reports mention this address.');
    expect(clue?.text.length).toBeLessThan(420);
    expect(state.points_available).toBe(RULES.roundPoints - RULES.investigationCost.check_address);
    expect(state.history[0]?.outcome).toBe('address_checked');
  });

  it('keep the run going at no cost when the agent is unavailable', () => {
    const seed = 'agent-down';
    const { state, applied } = applyMove(startRun({ runId: seed, seed }), seed, 'check_address', 0);
    expect(applied).toBe(true);
    expect(state.revealed_clues[0]?.text).toContain('Verdict unavailable');
    expect(state.points_available).toBe(RULES.roundPoints);
    expect(state.history[0]?.outcome).toBe('address_unavailable');
    // One attempt per round, so a player cannot loop on a dead agent.
    expect(state.legal_moves).not.toContain('check_address');
  });
});

describe('decisions', () => {
  it.each(DECISIONS.map((decision) => [decision]))('score %s by the rule table', (decision) => {
    for (const truth of ['scam', 'legitimate'] as const) {
      const seed = seedStartingWith(truth);
      const before = play(seed, ['ask_question']);
      const amount = before.scenario?.ask.amount ?? 0;
      const after = play(seed, [decision], before);
      const rule = DECISION_RULES[truth][decision];
      const available = RULES.roundPoints - RULES.investigationCost.ask_question;
      const points = Math.floor((available * rule.pointsPercent) / 100) + rule.bonus;

      expect(after.score, `${truth}/${decision}`).toBe(points);
      expect(after.lives).toBe(RULES.startingLives - (rule.costsLife ? 1 : 0));
      expect(after.last_round).toMatchObject({
        round: 1,
        was_scam: truth === 'scam',
        decision,
        outcome: rule.outcome,
        correct: rule.correct,
        points,
        amount,
      });
      const paidOut = rule.money === 'spent' || rule.money === 'lost';
      expect(after.wallet).toBe(RULES.startingWallet - (paidOut ? amount : 0));
      expect(after.money_lost).toBe(rule.money === 'lost' ? amount : 0);
      expect(after.money_recovered).toBe(rule.money === 'recovered' ? amount : 0);
      expect(after.round).toBe(2);
    }
  });

  it('recover a scam paid with holdback at half points and no life lost', () => {
    const seed = seedStartingWith('scam');
    const refused = play(seed, ['refuse']);
    const hedged = play(seed, ['pay_with_holdback']);
    const paid = play(seed, ['pay']);
    expect(refused.score).toBe(RULES.roundPoints);
    expect(hedged.score).toBe(RULES.roundPoints / 2);
    expect(hedged.lives).toBe(RULES.startingLives);
    expect(hedged.wallet).toBe(RULES.startingWallet);
    expect(hedged.money_recovered).toBe(hedged.last_round?.amount);
    expect(paid.score).toBe(0);
    expect(paid.lives).toBe(RULES.startingLives - 1);
    expect(paid.money_lost).toBe(paid.last_round?.amount);
  });

  it('reward a correct call more the fewer clues were used', () => {
    const seed = seedStartingWith('scam');
    const quick = play(seed, ['refuse']);
    const slow = play(seed, ['ask_question', 'verify_identity', 'refuse']);
    expect(quick.score).toBeGreaterThan(slow.score);
    expect(slow.score).toBe(
      RULES.roundPoints -
        RULES.investigationCost.ask_question -
        RULES.investigationCost.verify_identity,
    );
  });

  it('reveal the tells only after the decision', () => {
    const seed = 'reveal';
    const scenario = scenarioForRound(seed, 1);
    const after = play(seed, ['refuse']);
    expect(after.last_round?.scenario_id).toBe(scenario.id);
    expect(after.last_round?.tells).toEqual(scenario.tells);
    expect(after.last_round?.lesson).toBe(scenario.lesson);
  });
});

describe('end of run', () => {
  it('is won by a perfect player and carries a verifiable memo', () => {
    const seed = 'perfect';
    const state = playWith(seed, (current) => rightCall(seed, current));
    expect(state).toMatchObject({
      status: 'won',
      done: true,
      round: RULES.maxRounds,
      rounds_survived: RULES.maxRounds,
      lives: RULES.startingLives,
      score: RULES.maxRounds * RULES.roundPoints,
      scenario: null,
      legal_moves: [],
      money_at_risk: 0,
      points_available: 0,
    });
    const hash = createHash('sha256').update(canonicalHistory(state.history)).digest('hex');
    expect(state.result).toEqual({
      outcome: 'won',
      reason: 'cleared',
      score: state.score,
      rounds_survived: RULES.maxRounds,
      correct_decisions: RULES.maxRounds,
      money_lost: 0,
      money_recovered: 0,
      history_sha256: hash,
      memo: `holdback-dojo:${seed}:${state.score}:${hash}`,
      memo_status: 'pending',
      memo_signature: null,
    });
    expect(memoText(seed, state.score, hash)).toBe(state.result?.memo);
    expect(canonicalHistory(state.history).split('\n')[0]).toMatch(
      /^0\|1\|(pay|refuse)\|\w+\|150$/,
    );
  });

  it('is lost when the lives run out, before round eight', () => {
    const seed = 'careless';
    const state = playWith(seed, (current) => wrongCall(seed, current));
    expect(state.status).toBe('lost');
    expect(state.lives).toBe(0);
    expect(state.round).toBe(RULES.startingLives);
    expect(state.rounds_survived).toBe(RULES.startingLives - 1);
    expect(state.result?.reason).toBe('out_of_lives');
    expect(state.score).toBe(0);
  });

  it('is lost with all lives left when the score stays under the win score', () => {
    const seed = 'hedger';
    const state = playWith(seed, () => 'pay_with_holdback');
    expect(state.lives).toBe(RULES.startingLives);
    expect(state.rounds_survived).toBe(RULES.maxRounds);
    expect(state.score).toBeLessThan(RULES.winScore);
    expect(state.status).toBe('lost');
    expect(state.result?.reason).toBe('below_win_score');
  });

  it('is sticky: a finished run rejects every move and stays the same', () => {
    const seed = 'sticky';
    const finished = playWith(seed, (current) => rightCall(seed, current));
    for (const move of MOVES) {
      for (const turn of [finished.turn, finished.turn - 1, 0, null]) {
        const outcome = applyMove(finished, seed, move, turn);
        expect(outcome.applied).toBe(false);
        expect(outcome.error).toContain('The run is over (won');
        expect(outcome.state).toBe(finished);
      }
    }
  });

  it('records the memo signature or its absence', () => {
    const seed = 'memo';
    const finished = playWith(seed, (current) => rightCall(seed, current));
    expect(attachMemo(finished, '5sig').result).toMatchObject({
      memo_status: 'written',
      memo_signature: '5sig',
    });
    expect(attachMemo(finished, null).result).toMatchObject({
      memo_status: 'unavailable',
      memo_signature: null,
    });
    expect(() => attachMemo(startRun({ runId: seed, seed }), 'x')).toThrow();
  });

  it('can replay every decided round for spectators', () => {
    const seed = 'recap';
    const state = playWith(seed, (current) =>
      current.revealed_clues.length === 0 ? 'ask_question' : rightCall(seed, current),
    );
    const rounds = revealRounds(state, seed);
    expect(rounds).toHaveLength(RULES.maxRounds);
    expect(rounds[rounds.length - 1]).toEqual(state.last_round);
    expect(rounds.map((round) => round.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(revealRounds(startRun({ runId: seed, seed }), seed)).toEqual([]);
  });
});

describe('turns and illegal moves', () => {
  it('rejects unknown moves and returns the unchanged full state', () => {
    const seed = 'illegal';
    const state = play(seed, ['ask_question']);
    for (const move of ['jump', '', 'PAY', null, undefined, 7, { move: 'pay' }]) {
      const outcome = applyMove(state, seed, move, state.turn);
      expect(outcome.applied).toBe(false);
      expect(outcome.error).toContain('Unknown move');
      expect(outcome.error).toContain(`Legal moves: ${state.legal_moves.join(', ')}.`);
      expect(outcome.state).toBe(state);
    }
  });

  it('does not apply a replayed turn a second time', () => {
    const seed = 'replay';
    const start = startRun({ runId: seed, seed });
    const first = applyMove(start, seed, 'ask_question', 0);
    const replay = applyMove(first.state, seed, 'ask_question', 0);
    expect(replay.applied).toBe(false);
    expect(replay.state).toBe(first.state);
    expect(replay.state.revealed_clues).toHaveLength(1);
    expect(replay.error).toBe(
      'Turn 0 was already played as ask_question and was not applied again. The run is at turn 1: send turn 1 with your next move.',
    );

    // A decision replayed after the round moved on must not decide the next round.
    const decided = applyMove(first.state, seed, 'refuse', 1).state;
    const replayedDecision = applyMove(decided, seed, 'refuse', 1);
    expect(replayedDecision.applied).toBe(false);
    expect(replayedDecision.state.round).toBe(2);
    expect(replayedDecision.state.history).toHaveLength(2);
  });

  it('rejects a turn that is stale, ahead or malformed', () => {
    const seed = 'turns';
    const state = play(seed, ['ask_question', 'verify_identity']);
    for (const turn of [0, 5, -1, 1.5]) {
      const outcome = applyMove(state, seed, 'refuse', turn);
      expect(outcome.applied).toBe(false);
      expect(outcome.error).toBe(
        `Wrong turn: you sent ${turn}, the run is at turn 2. Nothing changed. Send turn 2.`,
      );
    }
  });

  it('applies a move sent without a turn', () => {
    const seed = 'no-turn';
    const outcome = applyMove(startRun({ runId: seed, seed }), seed, 'ask_question', null);
    expect(outcome.applied).toBe(true);
    expect(outcome.state.turn).toBe(1);
  });

  it('keeps turn, history and score consistent through whole runs', () => {
    for (let i = 0; i < 40; i++) {
      const seed = `consistent-${i}`;
      const state = playWith(seed, (current) =>
        current.revealed_clues.length < i % 4 && current.legal_moves.includes('ask_question')
          ? 'ask_question'
          : i % 3 === 0
            ? wrongCall(seed, current)
            : rightCall(seed, current),
      );
      expect(state.history).toHaveLength(state.turn);
      state.history.forEach((item, index) => expect(item.turn).toBe(index));
      expect(state.history.reduce((sum, item) => sum + item.points, 0)).toBe(state.score);
      expect(state.result?.score).toBe(state.score);
    }
  });
});
