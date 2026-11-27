'use client';

import { useEffect, useRef, useState } from 'react';

import { Bowl } from '@/components/art/Bowl';
import { BoxStamp, DateStamp } from '@/components/art/Stamps';
import { Ticket } from '@/components/art/Ticket';
import { playSound } from '@/lib/sound';

interface Step {
  name: string;
  text: string;
}

interface Props {
  steps: Step[];
  /** Names of the eight collectors, shown as slips of evidence in the first stage. */
  collectors: string[];
  /** The window, in seconds, of the tier used for the example (from the SDK). */
  windowSecs: number;
  windowText: string;
}

/**
 * The life of one payment, told by scrolling. The five stages scroll past on
 * the left; on the right one drawing stays in place and changes with them:
 * evidence arrives, the hole is punched, the hash is stamped, the payment is
 * crossed and the bowl fills, and at the end a hand lifts it out.
 *
 * Decisive things (the punch, the stamps, the lift) happen at once when their
 * stage arrives, because a punch is not a slow thing. Only the bowl's fill is
 * tied to the scroll position.
 *
 * It is an enhancement: the page shows the same five stages as a plain list
 * on phones, with reduced motion, and without scripts (see the styles).
 */
export function PaymentStory({ steps, collectors, windowSecs, windowText }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const bowlRef = useRef<HTMLDivElement>(null);
  const reached = useRef(0);

  useEffect(() => {
    const root = rootRef.current;
    // The story is only shown on wide screens with motion welcome (see the styles);
    // elsewhere the plain list is the content and nothing is loaded.
    const shown = window.matchMedia(
      '(min-width: 900px) and (prefers-reduced-motion: no-preference)',
    ).matches;
    if (!root || !shown) return;
    let cancelled = false;
    let revert: (() => void) | undefined;

    void (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const context = gsap.context(() => {
        root.querySelectorAll<HTMLElement>('.story__step').forEach((element, index) => {
          ScrollTrigger.create({
            trigger: element,
            start: 'top 62%',
            end: 'bottom 62%',
            onToggle: (self) => {
              if (!self.isActive) return;
              setStep(index);
              // Sounds only for marks made on the way down, never when scrolling back.
              if (index > reached.current) {
                reached.current = index;
                if (index === 1) playSound('punch');
                if (index === 2) playSound('stamp');
                if (index === 4) playSound('lift');
              }
            },
          });
        });
        const hold = root.querySelector<HTMLElement>('.story__step:nth-child(4)');
        if (hold) {
          ScrollTrigger.create({
            trigger: hold,
            start: 'top 62%',
            end: 'bottom 62%',
            scrub: 0.6,
            // Written straight to a CSS variable: no React render per scroll frame.
            onUpdate: (self) =>
              bowlRef.current?.style.setProperty(
                '--story-fill',
                String(0.15 + self.progress * 0.6),
              ),
          });
        }
      }, root);
      revert = () => context.revert();
    })();

    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);

  return (
    <div className="story" ref={rootRef} data-step={step}>
      <ol className="story__steps">
        {steps.map((item, index) => (
          <li key={item.name} className={`story__step${index === step ? ' is-active' : ''}`}>
            <span className="story__n num" aria-hidden="true">
              {index + 1}
            </span>
            <h3 className="story__name">{item.name}</h3>
            <p className="prose">{item.text}</p>
          </li>
        ))}
      </ol>

      <div className="story__stage" aria-hidden="true">
        <div className="story__frame" data-ink="ochre">
          <ul className="story__slips">
            {collectors.map((name, index) => (
              <li key={name} style={{ ['--i' as string]: index }}>
                {name}
              </li>
            ))}
          </ul>

          <div className="story__ticket">
            <Ticket
              ink="ochre"
              windowSecs={step >= 1 ? windowSecs : 0}
              serial="Specimen"
              amount="25"
              unit="USDC"
              blockNote="Held on-chain"
              gridLabel="Hours you can take it back"
              tierLabel={step >= 1 ? 'Suspicious' : 'Being assessed'}
              windowText={step >= 1 ? windowText : '…'}
              footLine="Punched by the risk agent. Final once signed."
              animate
              title=""
            >
              {step >= 4 ? (
                <BoxStamp text="Taken back" ink="red" className="stamp--struck" />
              ) : null}
            </Ticket>
            <svg viewBox="0 0 300 300" className="story__crossing">
              <path d="M96 300 L186 0" pathLength={1} />
              <path d="M124 300 L214 0" pathLength={1} />
            </svg>
            <span className="story__hash">
              <DateStamp
                top="EVIDENCE · SHA-256"
                bottom="WRITTEN INTO THE HOLD"
                line1="32 BYTES"
                line2="ON-CHAIN"
                ink="magenta"
                rotate={0}
                size={170}
              />
            </span>
          </div>

          <div className="story__bowl" ref={bowlRef}>
            <Bowl fill={0.15} state={step >= 4 ? 'lifted' : 'floating'} title="" still={step < 3} />
          </div>
          <p className="story__caption label">
            {
              [
                'Evidence arrives',
                'The hole is punched',
                'The hash is stamped',
                'Held, and the clock runs',
                'Lifted out: undone',
              ][step]
            }
          </p>
        </div>
      </div>
    </div>
  );
}
