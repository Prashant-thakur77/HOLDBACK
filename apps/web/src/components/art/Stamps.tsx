import { useId, type CSSProperties } from 'react';

/**
 * Hand stamps. Ink is never even: the rings are drawn as broken strokes, as
 * shape and not as a texture. A stamp is struck at an angle and always
 * carries a word, a number or a date; none of these imitates a real postal
 * or official mark.
 */

type StampInk = 'red' | 'blue' | 'green' | 'magenta' | 'ink' | 'ochre' | 'water' | 'copper';

export interface BoxStampProps {
  text: string;
  ink?: StampInk;
  /** Degrees; stamps never sit square to the page. */
  rotate?: number;
  /** Height in px; the width follows the word. */
  size?: number;
  className?: string;
  lang?: string;
}

/** A boxed word struck across something: an outcome. */
export function BoxStamp({
  text,
  ink = 'red',
  rotate = -6,
  size = 56,
  className,
  lang,
}: BoxStampProps) {
  const upper = text.toUpperCase();
  // Devanagari and accented capitals run wider than plain Latin capitals.
  const width = Math.round([...upper].length * (lang === 'hi' ? 19 : 15.5) + 36);
  return (
    <span
      className={['stamp', 'stamp--box', className].filter(Boolean).join(' ')}
      data-ink={ink}
      style={{ '--rot': `${rotate}deg` } as CSSProperties}
    >
      <svg viewBox={`0 0 ${width} 56`} height={size} width={(size / 56) * width} aria-hidden="true">
        <rect
          x="3"
          y="3"
          width={width - 6}
          height="50"
          className="stamp__ring"
          strokeWidth="3.5"
          strokeDasharray={`${width * 0.9} 5 40 3 ${width * 3}`}
        />
        <rect
          x="8"
          y="8"
          width={width - 16}
          height="40"
          className="stamp__ring"
          strokeWidth="1.2"
        />
        <text x={width / 2} y="37" textAnchor="middle" className="stamp__word" lang={lang}>
          {upper}
        </text>
      </svg>
      <span className="visually-hidden">{text}</span>
    </span>
  );
}

export interface DateStampProps {
  /** Text on the upper curve. */
  top: string;
  /** Text on the lower curve. */
  bottom: string;
  /** Two short lines across the middle. */
  line1: string;
  line2?: string;
  ink?: StampInk;
  rotate?: number;
  size?: number;
  className?: string;
}

/** A circular date stamp: something happened at a time, and here is the mark. */
export function DateStamp({
  top,
  bottom,
  line1,
  line2,
  ink = 'red',
  rotate = -9,
  size = 140,
  className,
}: DateStampProps) {
  const id = useId();
  return (
    <span
      className={['stamp', 'stamp--date', className].filter(Boolean).join(' ')}
      data-ink={ink}
      style={{ '--rot': `${rotate}deg` } as CSSProperties}
    >
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
        <defs>
          <path id={`${id}a`} d="M60 60 m-41 0 a41 41 0 1 1 82 0" />
          <path id={`${id}b`} d="M60 60 m-44 0 a44 44 0 0 0 88 0" />
        </defs>
        <circle
          cx="60"
          cy="60"
          r="54"
          className="stamp__ring"
          strokeWidth="3.5"
          strokeDasharray="150 6 60 3 200"
        />
        <circle
          cx="60"
          cy="60"
          r="32"
          className="stamp__ring"
          strokeWidth="1.6"
          strokeDasharray="80 4 300"
        />
        <text className="stamp__curve">
          <textPath href={`#${id}a`} startOffset="50%" textAnchor="middle">
            {top}
          </textPath>
        </text>
        <text className="stamp__curve stamp__curve--low">
          <textPath href={`#${id}b`} startOffset="50%" textAnchor="middle">
            {bottom}
          </textPath>
        </text>
        <text x="60" y={line2 ? 58 : 64} textAnchor="middle" className="stamp__date">
          {line1}
        </text>
        {line2 ? (
          <text x="60" y="72" textAnchor="middle" className="stamp__date stamp__date--small">
            {line2}
          </text>
        ) : null}
      </svg>
      <span className="visually-hidden">
        {top}. {line1} {line2 ?? ''}
      </span>
    </span>
  );
}
