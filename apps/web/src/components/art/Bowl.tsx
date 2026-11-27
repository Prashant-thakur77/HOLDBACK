import { useId, type CSSProperties } from 'react';

/**
 * The sinking-bowl clock: a copper bowl with a pinhole, floating in a basin.
 * Water comes in through the hole at one steady rate, the bowl sits lower as
 * it fills, and it goes under when the time is up. Lifting it out ends the
 * count early, which is what an undo does to a hold.
 *
 * Drawn as an instrument in flat inks. `fill` runs from 0 (just set down) to
 * 1 (about to go under) and is applied through a CSS variable so the motion
 * stays on the compositor.
 */

export type BowlState = 'floating' | 'sunk' | 'lifted';

const BASIN = 'M22 96 H278 L262 250 Q150 268 38 250 Z';
const BOWL = 'M88 80 H212 Q212 142 150 142 Q88 142 88 80 Z';

export interface BowlProps {
  /** 0 to 1: how much of the window has run. */
  fill: number;
  state: BowlState;
  /** Accessible description, e.g. "The bowl is floating; 12 minutes left". */
  title: string;
  /** Still drawing for small sizes: no bobbing. */
  still?: boolean;
  className?: string;
}

export function Bowl({ fill, state, title, still = false, className }: BowlProps) {
  const id = useId();
  const clamped = Math.min(1, Math.max(0, fill));
  const style = { '--fill': clamped } as CSSProperties;
  const classes = ['bowl', `is-${state}`, still ? 'is-still' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <svg viewBox="0 0 300 280" role="img" aria-label={title} className={classes} style={style}>
      <defs>
        <clipPath id={`${id}basin`}>
          <path d={BASIN} />
        </clipPath>
        <clipPath id={`${id}bowl`}>
          <path d={BOWL} />
        </clipPath>
        <pattern id={`${id}hatch`} width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 6 L6 0" className="bowl__hatch" />
        </pattern>
      </defs>

      <path d={BASIN} className="bowl__tin" />
      <g clipPath={`url(#${id}basin)`}>
        <rect x="0" y="118" width="300" height="170" className="bowl__water" />
        <rect x="0" y="118" width="300" height="170" fill={`url(#${id}hatch)`} />
      </g>

      {/* The bowl travels as one piece: down as it fills, under when the time is up. */}
      <g className="bowl__travel">
        <g className="bowl__bob">
          <path d={BOWL} className="bowl__copper" />
          <g clipPath={`url(#${id}bowl)`}>
            <g className="bowl__inside">
              <rect x="80" y="80" width="140" height="70" className="bowl__water" />
              <path d="M88 80 h124" className="bowl__ripple" />
            </g>
          </g>
          <path d={BOWL} className="bowl__outline" />
          <path d="M82 80 H218" className="bowl__rim" />
          <path d="M104 94 q6 24 26 36" className="bowl__dent" />
          <circle cx="150" cy="141" r="3" className="bowl__pinhole" />
        </g>
      </g>

      {/* The water line is drawn over the bowl so a sunk bowl reads as under the surface. */}
      <g clipPath={`url(#${id}basin)`}>
        <path
          d="M22 118 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0"
          className="bowl__ripple"
        />
        <rect x="0" y="118" width="300" height="170" className="bowl__veil" />
      </g>
      <path d={BASIN} className="bowl__outline" />
      <path d="M14 96 H286" className="bowl__rim" />
    </svg>
  );
}
