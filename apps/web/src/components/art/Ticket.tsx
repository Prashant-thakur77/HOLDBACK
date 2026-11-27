import type { Lang } from '@holdback/sdk';
import { useId, type ReactNode } from 'react';

import { localDigits } from '@/lib/i18n';

/**
 * The punched ticket: the drawing of one hold. A serial, the amount in a
 * solid block, a grid of hours, and exactly one hole at the hour the undo
 * window ends. The hole is a real one (an SVG mask), so the page shows
 * through it, the way paper removed from a ticket cannot be put back.
 *
 * Two settings. The full ticket carries its small print and is meant to be
 * drawn about 300 px wide or more. The compact ticket drops the small print
 * and enlarges what is left, so nothing on it falls under 12 px when it is
 * drawn as narrow as 245 px.
 */

/** Grid cells: half an hour, hours 1 to 24, then two and three days. */
export const TICKET_CELLS = [
  '½',
  ...Array.from({ length: 24 }, (_, index) => String(index + 1)),
  '48',
  '72',
];
const COLUMNS = 9;
const CELL_W = 30;
const CELL_H = 24;
const GRID_X = 15;
const WIDTH = 300;

/** The cell a window of this many seconds is punched at, or `null` for no window. */
export function cellForWindow(windowSecs: number): number | null {
  if (windowSecs <= 0) return null;
  const hours = windowSecs / 3600;
  if (hours < 1) return 0;
  if (hours <= 24) return Math.round(hours);
  return hours <= 48 ? 25 : 26;
}

export interface TicketProps {
  /** Ink name from the tokens (`data-ink`): one ink per ticket. */
  ink: 'ink' | 'blue' | 'green' | 'ochre' | 'magenta' | 'red' | 'copper' | 'water';
  /** Undo window in seconds; decides where the hole goes. */
  windowSecs: number;
  serial: string;
  /** The figure in the solid block, already formatted. */
  amount: string;
  unit: string;
  /** Small line under the unit, e.g. "Held on-chain". Full ticket only. */
  blockNote?: string;
  /** Caption over the foot rule. Full ticket only. */
  gridLabel?: string;
  /** Foot line, left and right: the tier in plain words and the window in words. */
  tierLabel: string;
  windowText: string;
  /** Last line of small print. Full ticket only. */
  footLine?: string;
  lang?: Lang;
  /** Plays the punch once when the ticket is first drawn or the window changes. */
  animate?: boolean;
  /** Drops the small print and enlarges the rest, for narrow drawings. */
  compact?: boolean;
  /** Accessible description of the whole ticket. */
  title: string;
  /** A stamp struck across the face. */
  children?: ReactNode;
  className?: string;
}

export function Ticket({
  ink,
  windowSecs,
  serial,
  amount,
  unit,
  blockNote,
  gridLabel,
  tierLabel,
  windowText,
  footLine,
  lang = 'en',
  animate = false,
  compact = false,
  title,
  children,
  className,
}: TicketProps) {
  const maskId = useId();
  // The compact ticket is shorter: no caption row and no small print under the foot.
  const gridY = compact ? 116 : 118;
  const footY = compact ? 218 : 241;
  const height = compact ? 250 : 300;
  const punched = cellForWindow(windowSecs);
  const holeX = punched === null ? 0 : GRID_X + (punched % COLUMNS) * CELL_W + CELL_W / 2;
  const holeY = punched === null ? 0 : gridY + Math.floor(punched / COLUMNS) * CELL_H + CELL_H / 2;
  // The foot is torn, not cut: a row of small teeth removed from the bottom edge.
  const teeth = Array.from({ length: 25 }, (_, index) => {
    const x = index * 12.5;
    return `${x},${height - (index % 2 ? 0 : 7)}`;
  }).join(' ');
  const classes = ['ticket', compact ? 'ticket--compact' : '', className].filter(Boolean).join(' ');

  return (
    <div className={classes} data-ink={ink}>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={title} className="ticket__svg">
        <mask id={maskId}>
          <rect width={WIDTH} height={height} fill="#fff" />
          {punched === null ? null : (
            <circle
              key={punched}
              cx={holeX}
              cy={holeY}
              r="9.5"
              fill="#000"
              className={animate ? 'ticket__hole is-punching' : 'ticket__hole'}
            />
          )}
          <polygon points={`0,${height + 1} ${teeth} ${WIDTH},${height + 1}`} fill="#000" />
        </mask>
        <g mask={`url(#${maskId})`}>
          <rect width={WIDTH} height={height} className="tk-stock" />
          <rect
            x="6"
            y="6"
            width={WIDTH - 12}
            height={height - 18}
            className="tk-line"
            strokeWidth="2.5"
          />
          <text x="15" y="29" className="tk-serial" transform="rotate(-1.2 15 29)">
            {serial}
          </text>
          {compact ? null : (
            <text x={WIDTH - 15} y="27" textAnchor="end" className="tk-brand">
              HOLDBACK
            </text>
          )}
          <line x1="6" y1="38" x2={WIDTH - 6} y2="38" className="tk-line" strokeWidth="1" />
          <rect x="15" y="46" width={WIDTH - 30} height="62" className="tk-fill" />
          <text x="26" y="94" className="tk-amount">
            {localDigits(amount, lang)}
          </text>
          <text
            x={WIDTH - 26}
            y={compact || !blockNote ? 86 : 74}
            textAnchor="end"
            className="tk-unit"
          >
            {unit}
          </text>
          {compact || !blockNote ? null : (
            <text x={WIDTH - 26} y="96" textAnchor="end" className="tk-note">
              {blockNote}
            </text>
          )}
          {TICKET_CELLS.map((cell, index) => {
            const x = GRID_X + (index % COLUMNS) * CELL_W;
            const y = gridY + Math.floor(index / COLUMNS) * CELL_H;
            return (
              <g key={cell}>
                <rect
                  x={x}
                  y={y}
                  width={CELL_W}
                  height={CELL_H}
                  className="tk-line"
                  strokeWidth="1"
                />
                <text x={x + CELL_W / 2} y={y + 17} textAnchor="middle" className="tk-cell">
                  {localDigits(cell, lang)}
                </text>
              </g>
            );
          })}
          {compact || !gridLabel ? null : (
            <text x="15" y="213" className="tk-label">
              {gridLabel}
            </text>
          )}
          {compact ? null : (
            <line x1="15" y1="221" x2={WIDTH - 15} y2="221" className="tk-line" strokeWidth="1" />
          )}
          <text x="15" y={footY} className="tk-foot">
            {tierLabel}
          </text>
          <text x={WIDTH - 15} y={footY} textAnchor="end" className="tk-foot">
            {windowText}
          </text>
          {compact || !footLine ? null : (
            <text x="15" y="263" className="tk-small">
              {footLine}
            </text>
          )}
          <line
            x1="6"
            y1={height - 24}
            x2={WIDTH - 6}
            y2={height - 24}
            className="tk-line"
            strokeWidth="1"
            strokeDasharray="2 4"
          />
        </g>
        {punched === null ? null : (
          <circle cx={holeX} cy={holeY} r="9.5" className="ticket__burr" />
        )}
        {punched !== null && animate ? (
          <circle key={`chad-${punched}`} cx={holeX} cy={holeY} r="9" className="ticket__chad" />
        ) : null}
      </svg>
      {children ? <div className="ticket__stamp">{children}</div> : null}
    </div>
  );
}
