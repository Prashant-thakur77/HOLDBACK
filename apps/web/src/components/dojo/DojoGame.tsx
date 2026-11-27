'use client';

import type { Decision, DojoState, Investigation, Move, RoundRecap } from '@holdback/dojo';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { BoxStamp } from '@/components/art/Stamps';
import { explorerUrl } from '@/lib/cluster';

import { CLUE_SOURCES, DECISION_LABELS, INVESTIGATION_LABELS, recapMoney } from './labels';

const API = '/api/dojo';
const INVESTIGATIONS: Investigation[] = ['ask_question', 'verify_identity', 'check_address'];
const DECISIONS: Decision[] = ['refuse', 'report', 'pay_with_holdback', 'pay'];

/** A started run: the public state plus the token that authorises its moves. */
type Run = DojoState & { play_token?: string; error?: string | null };

interface Props {
  /** Point costs, from the engine's rules. */
  costs: Record<Investigation, number>;
  roundPoints: number;
}

function Recap({ recap }: { recap: RoundRecap }) {
  return (
    <section className="dojo-recap" aria-label={`Round ${recap.round} result`}>
      <div className="dojo-recap__stamps">
        <BoxStamp
          text={recap.was_scam ? 'Scam' : 'Honest'}
          ink={recap.was_scam ? 'red' : 'green'}
          rotate={-5}
          size={46}
          className="stamp--struck"
        />
        <span className="pill" data-ink={recap.correct ? 'green' : 'magenta'}>
          {recap.correct ? 'Good call' : 'Wrong call'}:{' '}
          {DECISION_LABELS[recap.decision].toLowerCase()}
        </span>
        <span className="small quiet">
          Round {recap.round}, {recap.points} points
        </span>
      </div>
      <p className="dojo-recap__lesson">{recap.lesson}</p>
      <p className="small">{recapMoney(recap)}</p>
      {recap.tells.length > 0 ? (
        <ul className="dojo-recap__tells">
          {recap.tells.map((tell) => (
            <li key={tell}>{tell}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Scam Dojo, played against this site's own `/api/dojo`. The engine runs on
 * the server; this component only shows the state it returns and sends moves
 * back with the turn they were decided on, so a retry can never apply twice.
 */
export function DojoGame({ costs, roundPoints }: Props) {
  const [run, setRun] = useState<Run | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [player, setPlayer] = useState('');
  const [busy, setBusy] = useState<Move | 'start' | 'memo' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const round = run?.round;

  // A new round or the result moves focus to the board and brings its top into
  // view, so the verdict on the round just decided is never left off-screen.
  useEffect(() => {
    const board = boardRef.current;
    if (round === undefined || !board) return;
    board.focus({ preventScroll: true });
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    board.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  }, [round, run?.done]);

  const call = useCallback(
    async (path: string, body: unknown, bearer: string | null): Promise<Run | null> => {
      try {
        const response = await fetch(`${API}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          },
          body: JSON.stringify(body),
        });
        const data = (await response.json().catch(() => null)) as Run | null;
        if (!data || typeof data.run_id !== 'string') {
          setFailure(
            response.status === 503
              ? 'The game cannot store runs right now. Try again in a moment.'
              : `The game did not answer as expected (status ${response.status}).`,
          );
          return null;
        }
        setFailure(data.error ?? null);
        return data;
      } catch {
        setFailure('The game could not be reached. Check your connection and try again.');
        return null;
      }
    },
    [],
  );

  const start = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy('start');
    const next = await call('/runs', player.trim() ? { player: player.trim() } : {}, null);
    if (next) {
      setToken(next.play_token ?? null);
      setRun(next);
    }
    setBusy(null);
  };

  const move = async (chosen: Move) => {
    if (!run || !token) return;
    setBusy(chosen);
    const next = await call(`/runs/${run.run_id}/moves`, { move: chosen, turn: run.turn }, token);
    if (next) setRun(next);
    setBusy(null);
  };

  const retryMemo = async () => {
    if (!run || !token) return;
    setBusy('memo');
    const next = await call(`/runs/${run.run_id}/memo`, {}, token);
    if (next) setRun(next);
    setBusy(null);
  };

  if (!run) {
    return (
      <form className="dojo-start panel" onSubmit={(event) => void start(event)}>
        <h2 className="h3">Start a run</h2>
        <p>
          Eight payment requests arrive one at a time. Each round starts worth {roundPoints} points;
          looking closer costs a few. Then you decide.
        </p>
        <div className="field">
          <label className="field__label" htmlFor="dojo-player">
            Your name on the scoreboard <span className="quiet">(optional)</span>
          </label>
          <input
            id="dojo-player"
            className="input"
            value={player}
            maxLength={32}
            onChange={(event) => setPlayer(event.target.value)}
            autoComplete="off"
          />
        </div>
        <button type="submit" className="btn" disabled={busy !== null}>
          {busy === 'start' ? 'Dealing…' : 'Deal the first request'}
        </button>
        {failure ? (
          <p className="notice" data-ink="red" role="alert">
            {failure}
          </p>
        ) : null}
      </form>
    );
  }

  const { scenario, result } = run;
  const legal = new Set(run.legal_moves);

  return (
    <div className="dojo-board" ref={boardRef} tabIndex={-1} aria-label="Scam Dojo board">
      <dl className="ledger dojo-board__score">
        <div className="ledger__cell">
          <dt className="label">Round</dt>
          <dd className="num">
            {Math.min(run.round, run.max_rounds)}
            <small> of {run.max_rounds}</small>
          </dd>
        </div>
        <div className="ledger__cell">
          <dt className="label">Lives</dt>
          <dd className="num">{run.lives}</dd>
        </div>
        <div className="ledger__cell">
          <dt className="label">Score, {run.win_score} to win</dt>
          <dd className="num">{run.score}</dd>
        </div>
        <div className="ledger__cell">
          <dt className="label">Practice wallet, USDC</dt>
          <dd className="num">{run.wallet.toLocaleString('en-US')}</dd>
        </div>
      </dl>

      <div aria-live="polite">{run.last_round ? <Recap recap={run.last_round} /> : null}</div>

      {result ? (
        <section className="dojo-result panel" aria-label="Result">
          <BoxStamp
            text={result.outcome === 'won' ? 'Run cleared' : 'Run lost'}
            ink={result.outcome === 'won' ? 'green' : 'red'}
            rotate={-4}
            className="stamp--struck"
          />
          <p className="lead">
            {result.outcome === 'won'
              ? `You finished all ${run.max_rounds} rounds with ${result.score} points.`
              : result.reason === 'out_of_lives'
                ? `Out of lives after ${result.rounds_survived} rounds, with ${result.score} points.`
                : `All rounds played, but ${result.score} points is under the ${run.win_score} needed.`}
          </p>
          <dl className="kv">
            <div className="kv__row">
              <dt>Good calls</dt>
              <dd>{result.correct_decisions}</dd>
            </div>
            <div className="kv__row">
              <dt>Lost to scams</dt>
              <dd>{result.money_lost.toLocaleString('en-US')} USDC</dd>
            </div>
            <div className="kv__row">
              <dt>Taken back in the window</dt>
              <dd>{result.money_recovered.toLocaleString('en-US')} USDC</dd>
            </div>
            <div className="kv__row">
              <dt>On-chain record</dt>
              <dd>
                {result.memo_signature ? (
                  <a
                    href={explorerUrl('tx', result.memo_signature)}
                    className="link"
                    rel="noreferrer"
                  >
                    Memo written to devnet
                  </a>
                ) : result.memo_status === 'pending' ? (
                  'Being written…'
                ) : (
                  <>
                    Not written ({result.memo_status}).{' '}
                    <button
                      type="button"
                      className="link dojo-result__retry"
                      disabled={busy !== null}
                      onClick={() => void retryMemo()}
                    >
                      Try again
                    </button>
                  </>
                )}
              </dd>
            </div>
            <div className="kv__row">
              <dt>History hash</dt>
              <dd className="mono">{result.history_sha256}</dd>
            </div>
          </dl>
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => void start()}
            >
              Play again
            </button>
            <Link href={`/dojo/watch/${run.run_id}`} className="btn btn--ghost">
              Open the replay page
            </Link>
          </div>
        </section>
      ) : scenario ? (
        <section className="dojo-request" aria-label={`Request ${run.round}`}>
          <header className="dojo-request__head">
            <p className="dojo-request__from">
              <span className="pill">{scenario.channel}</span> {scenario.from}
            </p>
            <p className="small quiet">Worth {run.points_available} points now</p>
          </header>
          <div className="dojo-request__transcript">
            {scenario.transcript.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
          <dl className="kv dojo-request__ask">
            <div className="kv__row">
              <dt>Asks for</dt>
              <dd className="dojo-request__amount">
                {scenario.ask.amount.toLocaleString('en-US')} {scenario.ask.currency}
              </dd>
            </div>
            <div className="kv__row">
              <dt>To</dt>
              <dd className="mono">{scenario.ask.to}</dd>
            </div>
            <div className="kv__row">
              <dt>For</dt>
              <dd>{scenario.ask.purpose}</dd>
            </div>
          </dl>

          {run.revealed_clues.length > 0 ? (
            <ul className="dojo-clues" aria-label="What you found out">
              {run.revealed_clues.map((clue, index) => (
                <li
                  key={index}
                  className="notice"
                  data-ink={clue.source === 'address' ? 'blue' : 'ink'}
                >
                  <strong>{CLUE_SOURCES[clue.source]}.</strong> {clue.text}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="dojo-moves">
            <fieldset disabled={busy !== null}>
              <legend className="label">Look closer</legend>
              <div className="dojo-moves__row">
                {INVESTIGATIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="dojo-move"
                    disabled={!legal.has(item)}
                    onClick={() => void move(item)}
                  >
                    <b>{INVESTIGATION_LABELS[item].label}</b>
                    <span className="small">
                      {INVESTIGATION_LABELS[item].hint}, costs {costs[item]}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset disabled={busy !== null}>
              <legend className="label">Decide</legend>
              <div className="dojo-moves__row dojo-moves__row--decide">
                {DECISIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={item === 'pay_with_holdback' ? 'btn' : 'btn btn--ghost'}
                    disabled={!legal.has(item)}
                    onClick={() => void move(item)}
                  >
                    {DECISION_LABELS[item]}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </section>
      ) : null}

      {failure ? (
        <p className="notice" data-ink="red" role="alert">
          {failure}
        </p>
      ) : null}
      <p className="small quiet dojo-board__watch">
        Anyone can watch this run:{' '}
        <Link href={`/dojo/watch/${run.run_id}`} className="link">
          spectator page
        </Link>
      </p>
    </div>
  );
}
