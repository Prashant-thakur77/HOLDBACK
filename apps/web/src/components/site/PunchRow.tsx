'use client';

import { useRef, useState, type KeyboardEvent } from 'react';

import { TICKET_CELLS } from '@/components/art/Ticket';
import { playSound } from '@/lib/sound';
import { spokenHours, tierForHours, type WindowFact } from '@/lib/windows';

const COLUMNS = 9;

function hoursOf(cell: string): number {
  return cell === '½' ? 0.5 : Number(cell);
}

/**
 * The footer's row of hours. Punch the hour you would want to change your
 * mind for, and it says which recipient the policy gives that window to. It
 * is the tier table read backwards, from the time to the reason.
 *
 * For the keyboard the grid is one tab stop: the arrow keys move between
 * hours, and Space or Enter punches.
 */
export function PunchRow({ windows }: { windows: WindowFact[] }) {
  const [punched, setPunched] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const line = punched
    ? tierForHours(hoursOf(punched), windows)
    : 'Punch the hour you would want to change your mind for.';

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowDown'
            ? COLUMNS
            : event.key === 'ArrowUp'
              ? -COLUMNS
              : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = Math.min(TICKET_CELLS.length - 1, Math.max(0, cursor + step));
    setCursor(next);
    cells.current[next]?.focus();
  };

  return (
    <div className="punch-row">
      <p className="punch-row__line" role="status">
        {line}
      </p>
      <div
        className="punch-row__cells"
        role="group"
        aria-label="Hours. Use the arrow keys to move and Space to punch."
        onKeyDown={onKeyDown}
      >
        {TICKET_CELLS.map((cell, index) => (
          <button
            key={cell}
            ref={(element) => {
              cells.current[index] = element;
            }}
            type="button"
            className="punch-row__cell"
            tabIndex={index === cursor ? 0 : -1}
            aria-pressed={punched === cell}
            aria-label={spokenHours(hoursOf(cell))}
            onFocus={() => setCursor(index)}
            onClick={() => {
              setPunched(punched === cell ? null : cell);
              playSound('punch');
            }}
          >
            <span aria-hidden="true">{cell}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
