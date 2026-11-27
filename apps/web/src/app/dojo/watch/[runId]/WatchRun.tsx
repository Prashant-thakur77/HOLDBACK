'use client';

import { useDojoWatch } from '@/hooks/useDojoWatch';
import type { DojoWatch } from '@/lib/dojo/watch';
import { explorerUrl } from '@/lib/cluster';

// Structure only, visual design pending. Logic: `useDojoWatch`.
export function WatchRun({ runId, initial }: { runId: string; initial: DojoWatch }) {
  const { run, status } = useDojoWatch(runId, initial);
  if (!run) return <p role="status">This run is not available.</p>;

  const { scenario, result } = run;
  return (
    <>
      <p role="status">
        {status === 'finished' ? 'Finished' : 'Live'}: {run.player}, round {run.round} of{' '}
        {run.max_rounds}, score {run.score}, lives {run.lives}
      </p>

      {scenario ? (
        <section aria-label="Current request">
          <h2>
            {scenario.channel} from {scenario.from}
          </h2>
          {scenario.transcript.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
          <p>
            Asks for {scenario.ask.amount} {scenario.ask.currency} to {scenario.ask.to}:{' '}
            {scenario.ask.purpose}
          </p>
          <ul aria-label="Clues">
            {run.revealed_clues.map((clue, index) => (
              <li key={index}>
                {clue.source}: {clue.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Decided rounds">
        <h2>Rounds</h2>
        <ol>
          {run.rounds.map((round) => (
            <li key={round.round}>
              {round.was_scam ? 'Scam' : 'Legitimate'} ({round.category}): {round.decision},{' '}
              {round.correct ? 'correct' : 'wrong'}, {round.points} points. {round.lesson}
            </li>
          ))}
        </ol>
      </section>

      {result ? (
        <section aria-label="Result">
          <h2>{result.outcome === 'won' ? 'Won' : 'Lost'}</h2>
          <p>
            Score {result.score}, {result.correct_decisions} correct decisions, lost{' '}
            {result.money_lost}, recovered {result.money_recovered}
          </p>
          {result.memo_signature ? (
            <a href={explorerUrl('tx', result.memo_signature)}>On-chain record of this run</a>
          ) : (
            <p>On-chain record: {result.memo_status}</p>
          )}
        </section>
      ) : null}
    </>
  );
}
