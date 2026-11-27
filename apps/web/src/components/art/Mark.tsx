import { useId } from 'react';

/**
 * The HOLDBACK mark: a solid ink ticket cell with an H reversed out and a
 * round hole punched through its crossbar. The H is cut out of the cell, so
 * the mark works on any ground.
 */
export function Mark({ size = 36, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      className={['mark', className].filter(Boolean).join(' ')}
    >
      <mask id={id}>
        <rect width="64" height="64" fill="#fff" />
        <path d="M15 11h11v42H15zM38 11h11v42H38zM24 23h16v18H24z" fill="#000" />
      </mask>
      <rect width="64" height="64" mask={`url(#${id})`} className="mark__cell" />
      <circle cx="32" cy="32" r="5.5" className="mark__punch" />
    </svg>
  );
}

/** The wordmark: condensed capitals. With `punched`, the O is a hole in a solid cell. */
export function Wordmark({ punched = false }: { punched?: boolean }) {
  if (!punched) return <span className="wordmark">HOLDBACK</span>;
  return (
    <span className="wordmark wordmark--punched" aria-label="HOLDBACK" role="img">
      <span aria-hidden="true">H</span>
      <span aria-hidden="true" className="wordmark__o" />
      <span aria-hidden="true">LDBACK</span>
    </span>
  );
}

/** A small arrow for "continued" links; drawn, because the text face has no arrows. */
export function Arrow({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M3 12h16M13 5l7 7-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="square"
      />
    </svg>
  );
}
