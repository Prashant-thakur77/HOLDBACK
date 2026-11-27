'use client';

import { Mark } from '@/components/art/Mark';
import { BoxStamp } from '@/components/art/Stamps';
import { CLUE_SOURCES, DECISION_LABELS, recapMoney } from '@/components/dojo/labels';
import { useDojoWatch } from '@/hooks/useDojoWatch';
import { explorerUrl } from '@/lib/cluster';
import type { DojoWatch } from '@/lib/dojo/watch';

/**
 * The spectator view of one run. It is embedded in a frame by the arena, so
 * it carries no site header, reads at 320 px, and never touches a wallet.
 * Logic: `useDojoWatch`.
 */
export function WatchRun({ runId, initial }: { runId: string; initial: DojoWatch }) {
  const { run, status } = useDojoWatch(runId, initial);
  if (!run) {
    return (
      <p className="notice" role="status">
        This run is not available.
      </p>
    );
  }

  const { scenario, result } = run;
  return (
    <div className="watch">
      <header className="watch__head">
        <span className="watch__brand">
          <Mark size={22} />
          <span className="label">HOLDBACK Scam Dojo</span>
        </span>
        <span className="pill" data-ink={status === 'finished' ? 'ink' : 'red'} role="status">
          {status === 'finished' ? 'Finished' : 'Live'}
        </span>
      </header>
      <h1 className="watch__player">{run.player}</h1>

      <dl className="ledger watch__score">
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
          <dt className="label">Score</dt>
          <dd className="num">{run.score}</dd>
        </div>
        <div className="ledger__cell">
          <dt className="label">To win</dt>
          <dd className="num">{run.win_score}</dd>
        </div>
      </dl>

      {result ? (
        <section className="watch__result" aria-label="Result">
          <BoxStamp
            text={result.outcome === 'won' ? 'Run cleared' : 'Run lost'}
            ink={result.outcome === 'won' ? 'green' : 'red'}
            rotate={-4}
            size={48}
          />
          <p>
            {result.correct_decisions} good calls. Lost {result.money_lost.toLocaleString('en-US')}{' '}
            USDC, took back {result.money_recovered.toLocaleString('en-US')} USDC.
          </p>
          {result.memo_signature ? (
            <a
              href={explorerUrl('tx', result.memo_signature)}
              className="link"
              target="_blank"
              rel="noreferrer"
            >
              On-chain record of this run
            </a>
          ) : (
            <p className="small quiet">On-chain record: {result.memo_status}</p>
          )}
        </section>
      ) : null}

      {scenario ? (
        <section className="dojo-request" aria-label="Current request">
          <header className="dojo-request__head">
            <h2 className="dojo-request__from">
              <span className="pill">{scenario.channel}</span> {scenario.from}
            </h2>
            <p className="small quiet">Worth {run.points_available} points</p>
          </header>
          <div className="dojo-request__transcript">
            {scenario.transcript.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
          <p className="watch__ask">
            Asks for{' '}
            <strong>
              {scenario.ask.amount.toLocaleString('en-US')} {scenario.ask.currency}
            </strong>{' '}
            to <span className="mono">{scenario.ask.to}</span>: {scenario.ask.purpose}
          </p>
          {run.revealed_clues.length > 0 ? (
            <ul className="dojo-clues" aria-label="Clues">
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
        </section>
      ) : null}

      <section aria-label="Decided rounds">
        <h2 className="label watch__rounds-title">Rounds played</h2>
        {run.rounds.length === 0 ? (
          <p className="small quiet">No round has been decided yet.</p>
        ) : (
          <ol className="watch__rounds">
            {run.rounds.map((round) => (
              <li key={round.round} data-ink={round.correct ? 'green' : 'magenta'}>
                <p className="watch__round-line">
                  <span className="mono">{String(round.round).padStart(2, '0')}</span>
                  <span className="pill" data-ink={round.was_scam ? 'red' : 'green'}>
                    {round.was_scam ? 'Scam' : 'Honest'}
                  </span>
                  <strong>{DECISION_LABELS[round.decision]}</strong>
                  <span className="small">
                    {round.correct ? 'good call' : 'wrong call'}, {round.points} points
                  </span>
                </p>
                <p className="small">
                  {round.lesson} {recapMoney(round)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
