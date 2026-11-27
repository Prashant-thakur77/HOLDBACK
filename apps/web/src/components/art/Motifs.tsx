import type { ReactNode } from 'react';

/**
 * The illustration set: the things found on the counter where money changes
 * hands. One ink line of even weight, flat accent fills in the ink of the
 * page they sit on (`--tk`), no shading, nothing copied from a real object.
 *
 * Every stroke carries `pathLength="1"`, so a motif can draw itself in when
 * it arrives on screen (see `[data-reveal='draw']` in art.css) and still be
 * a complete, still drawing without scripts or with reduced motion.
 */

export type MotifName =
  | 'punch'
  | 'stamp'
  | 'ledger'
  | 'phone'
  | 'counter'
  | 'speaker'
  | 'report'
  | 'box'
  | 'slips'
  | 'tickets';

interface MotifProps {
  name: MotifName;
  /** Rendered width and height in px. */
  size?: number;
  /** Text alternative; omit when the motif only repeats the text beside it. */
  title?: string;
  className?: string;
}

/** A stroke that can be drawn in: normalised length, no fill. */
function L({ d, w = 2.5 }: { d: string; w?: number }) {
  return <path d={d} pathLength={1} strokeWidth={w} className="motif__line" />;
}

/** A flat accent shape in the page's ink. */
function A({ d }: { d: string }) {
  return <path d={d} className="motif__accent" />;
}

/** A flat paper shape, to keep lines behind it from showing through. */
function P({ d }: { d: string }) {
  return <path d={d} className="motif__paper" />;
}

const DRAWINGS: Record<MotifName, ReactNode> = {
  // A conductor's ticket punch: two handles, a jaw, the round die, and the chad it just cut.
  punch: (
    <>
      <A d="M70 30 L104 20 L108 34 L76 46 Z" />
      <L d="M14 96 L62 50 L74 28 L104 20 L108 34 L78 46 L70 60 L26 106 Z" />
      <L d="M22 60 L60 62 L76 46" />
      <L d="M22 60 L16 72 L52 76" />
      <circle cx="92" cy="30" r="5" pathLength={1} strokeWidth={2.5} className="motif__line" />
      <circle cx="64" cy="57" r="3" className="motif__dot" />
      <circle cx="96" cy="70" r="6" className="motif__accent" />
      <L d="M96 52 v6 M88 56 l3 4 M104 56 l-3 4" w={2} />
    </>
  ),
  // A rubber hand stamp above the boxed mark it has just left.
  stamp: (
    <>
      <A d="M30 62 H90 V78 H30 Z" />
      <L d="M50 14 H70 Q76 14 74 24 L68 50 H52 L46 24 Q44 14 50 14 Z" />
      <L d="M38 50 H82 V62 H38 Z" />
      <L d="M30 62 H90 V78 H30 Z" />
      <L d="M22 92 H98 V110 H22 Z" w={2} />
      <L d="M32 101 H66 M72 101 H88" w={2} />
    </>
  ),
  // An open ledger: ruled lines, a figures column, one entry ruled off.
  ledger: (
    <>
      <P d="M12 28 Q36 18 60 28 Q84 18 108 28 V98 Q84 88 60 98 Q36 88 12 98 Z" />
      <A d="M88 30 Q98 26 108 28 V98 Q98 94 88 96 Z" />
      <L d="M12 28 Q36 18 60 28 Q84 18 108 28 V98 Q84 88 60 98 Q36 88 12 98 Z" />
      <L d="M60 28 V98" />
      <L
        d="M22 42 Q36 37 50 42 M22 54 Q36 49 50 54 M22 66 Q36 61 50 66 M22 78 Q36 73 50 78"
        w={2}
      />
      <L d="M70 42 Q76 39 82 40 M70 54 Q76 51 82 52 M70 66 Q76 63 82 64" w={2} />
      <L d="M88 30 V96" w={2} />
      <L d="M68 80 L84 76" w={3} />
    </>
  ),
  // A phone showing a punched ticket.
  phone: (
    <>
      <P d="M34 10 H86 V110 H34 Z" />
      <L d="M34 10 H86 V110 H34 Z" />
      <L d="M52 18 H68" w={2} />
      <A d="M42 30 H78 V46 H42 Z" />
      <L d="M42 30 H78 V86 H42 Z" w={2} />
      <L d="M42 56 H78 M42 66 H78 M42 76 H78 M54 46 V86 M66 46 V86" w={1.5} />
      <circle cx="60" cy="71" r="4.5" className="motif__dot" />
      <L d="M54 98 H66" w={2} />
    </>
  ),
  // The counter itself: a window, a grille, a slab, and a slip being handed back.
  counter: (
    <>
      <L d="M16 104 V20 H104 V104" />
      <L d="M8 104 H112" w={4} />
      <L d="M16 74 H104" />
      <L d="M32 20 V74 M48 20 V74 M72 20 V74 M88 20 V74" w={1.5} />
      <P d="M48 62 H72 V74 H48 Z" />
      <L d="M48 74 V62 H72 V74" />
      <A d="M40 82 H80 V96 H40 Z" />
      <L d="M40 82 H80 V96 H40 Z" w={2} />
      <L d="M48 89 H64" w={2} />
    </>
  ),
  // The speaker on the shop counter that says each payment aloud.
  speaker: (
    <>
      <A d="M26 44 H74 V100 H26 Z" />
      <L d="M26 44 H74 V100 H26 Z" />
      <L d="M20 100 H80" w={4} />
      <circle cx="50" cy="72" r="15" className="motif__paper" />
      <circle cx="50" cy="72" r="15" pathLength={1} strokeWidth={2.5} className="motif__line" />
      <circle cx="50" cy="72" r="4" className="motif__dot" />
      <L d="M36 44 V34 H64 V44" w={2} />
      <g className="motif__pulse">
        <L d="M84 60 Q92 72 84 84" w={2.5} />
        <L d="M93 52 Q106 72 93 92" w={2.5} />
      </g>
    </>
  ),
  // A web report with the exact address found in it.
  report: (
    <>
      <P d="M20 12 H78 V104 H20 Z" />
      <L d="M20 12 H78 V104 H20 Z" />
      <L d="M30 28 H68 M30 40 H68 M30 76 H60 M30 88 H52" w={2} />
      <A d="M30 52 H68 V64 H30 Z" />
      <circle cx="78" cy="72" r="19" className="motif__paper" />
      <circle cx="78" cy="72" r="19" pathLength={1} strokeWidth={3} className="motif__line" />
      <L d="M68 68 H88 M68 77 H82" w={2.5} />
      <L d="M92 86 L108 104" w={5} />
    </>
  ),
  // A deposit box: money goes in at the slot and can only come back to its owner.
  box: (
    <>
      <A d="M18 48 H92 V62 H18 Z" />
      <L d="M18 48 H92 V104 H18 Z" />
      <L d="M18 62 H92" />
      <L d="M40 55 H70" w={3.5} />
      <P d="M44 14 H66 V46 H44 Z" />
      <L d="M44 46 V14 H66 V46" />
      <L d="M50 24 H60 M50 32 H60" w={2} />
      <L d="M100 96 Q112 80 100 64" w={2.5} />
      <L d="M96 72 L100 63 L108 68" w={2.5} />
      <L d="M34 82 H76 M34 92 H60" w={2} />
    </>
  ),
  // Message slips: the requests that arrive in Scam Dojo.
  slips: (
    <>
      <P d="M14 18 H74 V52 H34 L22 64 V52 H14 Z" />
      <L d="M14 18 H74 V52 H34 L22 64 V52 H14 Z" />
      <L d="M24 30 H64 M24 40 H52" w={2} />
      <A d="M46 60 H106 V94 H98 V106 L86 94 H46 Z" />
      <L d="M46 60 H106 V94 H98 V106 L86 94 H46 Z" />
      <L d="M56 72 H96 M56 82 H84" w={2} />
    </>
  ),
  // A pad of tickets, the top one punched.
  tickets: (
    <>
      <L d="M26 30 H98 V100 H26 Z" />
      <P d="M20 22 H92 V92 H20 Z" />
      <L d="M20 22 H92 V92 H20 Z" />
      <P d="M14 14 H86 V84 H14 Z" />
      <A d="M22 22 H78 V38 H22 Z" />
      <L d="M14 14 H86 V84 H14 Z" />
      <L d="M22 48 H78 M22 60 H78 M22 72 H78 M36 48 V72 M50 48 V72 M64 48 V72" w={1.5} />
      <circle cx="57" cy="66" r="4.5" className="motif__dot" />
    </>
  ),
};

/** One drawing from the set. Colour comes from the nearest `data-ink`. */
export function Motif({ name, size = 120, title, className }: MotifProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={['motif', className].filter(Boolean).join(' ')}
    >
      {DRAWINGS[name]}
    </svg>
  );
}
