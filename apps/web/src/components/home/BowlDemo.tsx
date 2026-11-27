'use client';

import type { TierName } from '@holdback/sdk';
import { useEffect, useRef, useState } from 'react';

import { Bowl } from '@/components/art/Bowl';
import { BoxStamp } from '@/components/art/Stamps';
import { Ticket } from '@/components/art/Ticket';
import { useLang } from '@/components/LangProvider';
import { TIER_INK, clockLabel, windowLabel, type MessageKey } from '@/lib/i18n';

/** Seconds of screen time that stand for a whole undo window. Said in the caption. */
const DEMO_SECS = 30;
const TICK_MS = 300;

type DemoTier = Extract<TierName, 'TRUSTED' | 'UNKNOWN' | 'SUSPICIOUS' | 'FLAGGED'>;
type Phase = 'floating' | 'lifted' | 'sunk' | 'instant';

const CHOICES: { tier: DemoTier; label: MessageKey }[] = [
  { tier: 'TRUSTED', label: 'demo.trusted' },
  { tier: 'UNKNOWN', label: 'demo.unknown' },
  { tier: 'SUSPICIOUS', label: 'demo.suspicious' },
  { tier: 'FLAGGED', label: 'demo.flagged' },
];

interface Props {
  /** Undo window per tier in seconds, from the SDK's policy table. */
  windows: Record<DemoTier, number>;
}

/**
 * The signature moment: lift the bowl before it sinks.
 *
 * The visitor says who they are paying. The policy's window for that tier is
 * punched into the ticket, the bowl is set on the water and fills at one
 * steady rate, and "Take it back" lifts it out. Waiting lets it go under,
 * which is a release. It is the product in one tap: the evidence sizes the
 * hole, time is the bowl filling, undo is a hand.
 */
export function BowlDemo({ windows }: Props) {
  const { lang, t } = useLang();
  const [tier, setTier] = useState<DemoTier>('UNKNOWN');
  const [phase, setPhase] = useState<Phase>('floating');
  const [progress, setProgress] = useState(0);
  // The punch plays only after the visitor has chosen, never on first paint.
  const [touched, setTouched] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const onScreen = useRef(true);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      onScreen.current = entry?.isIntersecting ?? true;
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  // The clock: the only linear motion on the site. It rests while nobody can see it.
  useEffect(() => {
    if (phase !== 'floating') return;
    const timer = window.setInterval(() => {
      if (!onScreen.current || document.visibilityState !== 'visible') return;
      setProgress((value) => {
        const next = value + TICK_MS / 1000 / DEMO_SECS;
        if (next >= 1) {
          setPhase('sunk');
          return 1;
        }
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

  const start = (next: DemoTier) => {
    setTier(next);
    setProgress(0);
    setPhase(windows[next] === 0 ? 'instant' : 'floating');
    setTouched(true);
  };

  const windowSecs = windows[tier];
  const remaining = windowSecs * (1 - progress);
  const status: MessageKey | null =
    phase === 'lifted'
      ? 'demo.lifted'
      : phase === 'sunk'
        ? 'demo.sunk'
        : phase === 'instant'
          ? 'demo.instant'
          : null;

  return (
    <div className="demo" ref={panelRef} lang={lang === 'en' ? undefined : lang}>
      <div className="demo__stage">
        <Ticket
          ink={TIER_INK[tier]}
          windowSecs={windowSecs}
          serial={t('ticket.specimen')}
          amount="25"
          unit="USDC"
          blockNote={t('ticket.held')}
          gridLabel={t('ticket.grid')}
          tierLabel={t(`tier.${tier}`)}
          windowText={windowLabel(windowSecs, lang)}
          footLine={t('ticket.foot')}
          lang={lang}
          animate={touched}
          title={`${t('ticket.specimen')}: 25 USDC, ${t(`tier.${tier}`)}, ${windowLabel(windowSecs, lang)}`}
        >
          {phase === 'lifted' ? (
            <BoxStamp text={t('stamp.takenBack')} ink="red" className="stamp--struck" lang={lang} />
          ) : phase === 'sunk' ? (
            <BoxStamp
              text={t('stamp.released')}
              ink="ink"
              rotate={-4}
              className="stamp--struck"
              lang={lang}
            />
          ) : phase === 'instant' ? (
            <BoxStamp
              text={t('stamp.paid')}
              ink="green"
              rotate={-4}
              className="stamp--struck"
              lang={lang}
            />
          ) : null}
        </Ticket>

        <div className="demo__clock">
          <p className="demo__time num" aria-hidden="true">
            {phase === 'instant' ? clockLabel(0, lang) : clockLabel(remaining, lang)}
          </p>
          <p className="label demo__left">{t('demo.left')}</p>
          <Bowl
            fill={progress}
            state={phase === 'floating' ? 'floating' : phase === 'sunk' ? 'sunk' : 'lifted'}
            title={
              status
                ? t(status)
                : `${t('demo.left')}: ${windowLabel(Math.max(60, remaining), lang)}`
            }
          />
        </div>
      </div>

      <fieldset className="demo__choices">
        <legend className="label">{t('demo.question')}</legend>
        <div className="demo__seg">
          {CHOICES.map((choice) => (
            <label key={choice.tier} className="demo__choice" data-ink={TIER_INK[choice.tier]}>
              <input
                type="radio"
                name="demo-tier"
                value={choice.tier}
                checked={tier === choice.tier}
                onChange={() => start(choice.tier)}
              />
              <span>
                <i className="patch" aria-hidden="true" />
                {t(choice.label)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="demo__action">
        {phase === 'floating' ? (
          <button type="button" className="btn demo__btn" onClick={() => setPhase('lifted')}>
            {t('action.undo')}
          </button>
        ) : (
          <button type="button" className="btn btn--ghost demo__btn" onClick={() => start(tier)}>
            {t('demo.again')}
          </button>
        )}
        <p className="demo__status" role="status">
          {status ? t(status) : t(`warn.${tier}`)}
        </p>
      </div>
      <p className="demo__note small quiet">{t('demo.note')}</p>
    </div>
  );
}
