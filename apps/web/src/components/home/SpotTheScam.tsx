'use client';

import Link from 'next/link';
import { useState } from 'react';

import { BoxStamp } from '@/components/art/Stamps';
import { playSound } from '@/lib/sound';

export interface QuickCase {
  id: string;
  scam: boolean;
  channel: string;
  from: string;
  transcript: string[];
  amount: number;
  purpose: string;
  tells: string[];
  lesson: string;
}

/**
 * Three real requests from Scam Dojo's written scenarios. The visitor marks
 * each one "scam" or "honest", the way a box is marked on a slip, and the
 * answer is stamped with the tells that give it away. One of the three is
 * honest, because refusing everything is not a skill.
 */
export function SpotTheScam({ cases }: { cases: QuickCase[] }) {
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const answered = Object.keys(answers).length;
  const right = cases.filter((item) => answers[item.id] === item.scam).length;

  const answer = (item: QuickCase, saysScam: boolean) => {
    setAnswers((current) => ({ ...current, [item.id]: saysScam }));
    playSound('stamp');
  };

  return (
    <div className="spot">
      <ol className="spot__list">
        {cases.map((item, index) => {
          const guess = answers[item.id];
          const done = guess !== undefined;
          return (
            <li key={item.id} className={`spot__case${done ? ' is-done' : ''}`}>
              <p className="spot__from">
                <span className="mono" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="pill">{item.channel}</span> {item.from}
              </p>
              <div className="spot__lines">
                {item.transcript.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <p className="spot__ask">
                Asks for <strong>{item.amount.toLocaleString('en-US')} USDC</strong>: {item.purpose}
              </p>

              {done ? (
                <div className="spot__reveal" role="status">
                  <BoxStamp
                    text={item.scam ? 'Scam' : 'Honest'}
                    ink={item.scam ? 'red' : 'green'}
                    rotate={-5}
                    size={48}
                    className="stamp--struck"
                  />
                  <p className="spot__verdict">
                    {guess === item.scam ? 'You called it.' : 'Not this time.'} {item.lesson}
                  </p>
                  <ul className="spot__tells">
                    {item.tells.slice(0, 3).map((tell) => (
                      <li key={tell}>{tell}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div
                  className="spot__choice"
                  role="group"
                  aria-label={`Request ${index + 1}: your call`}
                >
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => answer(item, true)}
                  >
                    Scam
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => answer(item, false)}
                  >
                    Honest
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="spot__foot" aria-live="polite">
        {answered === cases.length ? (
          <>
            <p className="spot__score">
              <span className="num">
                {right} of {cases.length}
              </span>
              <span>
                {right === cases.length
                  ? 'All three. The full game is harder: you can ask, verify and check the address.'
                  : 'The full game lets you ask questions, verify who it is and check the address before you decide.'}
              </span>
            </p>
            <div className="btn-row">
              <Link href="/dojo" className="btn" data-magnetic>
                Play all eight rounds
              </Link>
              <button type="button" className="btn btn--ghost" onClick={() => setAnswers({})}>
                Try these again
              </button>
            </div>
          </>
        ) : (
          <p className="quiet">
            {answered === 0
              ? 'Three messages. One of them is honest. Mark each one.'
              : `${cases.length - answered} to go.`}
          </p>
        )}
      </div>
    </div>
  );
}
