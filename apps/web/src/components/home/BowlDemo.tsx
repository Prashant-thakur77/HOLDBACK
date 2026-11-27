'use client';

import type { TierName } from '@holdback/sdk';
import { useEffect, useRef, useState } from 'react';

import { Bowl } from '@/components/art/Bowl';
import { BoxStamp } from '@/components/art/Stamps';
import { Ticket } from '@/components/art/Ticket';
import { useLang } from '@/components/LangProvider';
import { SoundToggle } from '@/components/site/SoundToggle';
import { TIER_INK, clockLabel, windowLabel, type MessageKey } from '@/lib/i18n';
import { playSound } from '@/lib/sound';

/** Seconds of screen time that stand for a whole undo window. Said in the caption. */
const DEMO_SECS = 30;
const TICK_MS = 300;
/** The slider runs a quarter past the window, so "too late" can be reached and seen. */
const SLIDER_MAX = 1.25;

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
 * which is a release. The time can also be dragged by hand, to see at which
 * hour an undo is still possible and at which it is too late. It is the
 * product in one tap: the evidence sizes the hole, time is the bowl filling,
 * undo is a hand.
 */
export function BowlDemo({ windows }: Props) {
  const { lang, t } = useLang();
  const [tier, setTier] = useState<DemoTier>('UNKNOWN');
  const [phase, setPhase] = useState<Phase>('floating');
  /** Elapsed share of the window: 0 just paid, 1 the window ends. */
  const [elapsed, setElapsed] = useState(0);
  /** Dragging the time by hand stops the clock from running on its own. */
  const [byHand, setByHand] = useState(false);
  // The punch plays only after the visitor has chosen, never on first paint.
  const [touched, setTouched] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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
    if (phase !== 'floating' || byHand) return;
    const timer = window.setInterval(() => {
      if (!onScreen.current || document.visibilityState !== 'visible') return;
      setElapsed((value) => Math.min(1, value + TICK_MS / 1000 / DEMO_SECS));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase, byHand]);

  // An outcome is stamped on the ticket. On a small screen the ticket may have
  // scrolled above the controls, so it is brought back into view to be seen.
  useEffect(() => {
    if (phase !== 'lifted' && phase !== 'sunk') return;
    const stage = stageRef.current;
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    if (box.top >= 60 && box.bottom <= window.innerHeight) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    stage.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  }, [phase]);

  // The bowl goes under the moment the window ends, however the time got there.
  useEffect(() => {
    if (phase === 'floating' && elapsed >= 1) {
      setPhase('sunk');
      playSound('gong');
    } else if (phase === 'sunk' && elapsed < 1) {
      setPhase('floating');
    }
  }, [elapsed, phase]);

  const start = (next: DemoTier) => {
    setTier(next);
    setElapsed(0);
    setByHand(false);
    setPhase(windows[next] === 0 ? 'instant' : 'floating');
    setTouched(true);
    playSound('punch');
  };

  const takeBack = () => {
    setPhase('lifted');
    playSound('lift');
    window.setTimeout(() => playSound('stamp'), 180);
  };

  const windowSecs = windows[tier];
  const remaining = windowSecs * Math.max(0, 1 - elapsed);
  const status: MessageKey | null =
    phase === 'lifted'
      ? 'demo.lifted'
      : phase === 'sunk'
        ? 'demo.sunk'
        : phase === 'instant'
          ? 'demo.instant'
          : null;
  const sliderOff = phase === 'instant' || phase === 'lifted';

  return (
    <div className="demo" ref={panelRef} lang={lang === 'en' ? undefined : lang}>
      <div className="demo__stage" ref={stageRef}>
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
            fill={Math.min(1, elapsed)}
            state={phase === 'floating' ? 'floating' : phase === 'sunk' ? 'sunk' : 'lifted'}
            title={
              status
                ? t(status)
                : `${t('demo.left')}: ${windowLabel(Math.max(60, remaining), lang)}`
            }
          />
        </div>
      </div>

      <div className={`demo__slider${sliderOff ? ' is-off' : ''}`}>
        <label className="label" htmlFor="demo-time">
          {t('demo.slider')}
        </label>
        <input
          id="demo-time"
          type="range"
          min={0}
          max={SLIDER_MAX}
          step={0.005}
          value={sliderOff ? 0 : elapsed}
          disabled={sliderOff}
          onChange={(event) => {
            setByHand(true);
            setElapsed(Number(event.target.value));
          }}
          aria-valuetext={`${clockLabel(windowSecs * elapsed, lang)}. ${t(elapsed < 1 ? 'demo.still' : 'demo.late')}`}
          style={{ ['--at' as string]: `${(Math.min(elapsed, SLIDER_MAX) / SLIDER_MAX) * 100}%` }}
        />
        <p className="demo__slider-read small" aria-hidden="true">
          <span className="mono">{clockLabel(windowSecs * (sliderOff ? 0 : elapsed), lang)}</span>
          <span>{sliderOff ? t('demo.drag') : t(elapsed < 1 ? 'demo.still' : 'demo.late')}</span>
        </p>
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
          <button type="button" className="btn demo__btn" onClick={takeBack}>
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
      <div className="demo__note small quiet">
        <span>{t('demo.note')}</span>
        <SoundToggle />
      </div>
    </div>
  );
}
