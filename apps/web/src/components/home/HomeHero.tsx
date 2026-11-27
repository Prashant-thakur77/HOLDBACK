'use client';

import type { TierName } from '@holdback/sdk';
import Link from 'next/link';

import { Arrow } from '@/components/art/Mark';
import { useLang } from '@/components/LangProvider';

import { BowlDemo } from './BowlDemo';

type DemoTier = Extract<TierName, 'TRUSTED' | 'UNKNOWN' | 'SUSPICIOUS' | 'FLAGGED'>;

/**
 * First screen: the claim, one action, and the thing itself to try. The
 * second line of the headline sits in a solid block of ink, the way the fare
 * sits on a ticket.
 */
export function HomeHero({
  windows,
  exampleHold,
}: {
  windows: Record<DemoTier, number>;
  /** A real hold whose receipt a visitor can open without a wallet. */
  exampleHold: string;
}) {
  const { lang, t } = useLang();
  const tagged = lang === 'en' ? undefined : lang;
  return (
    <section className="hero wrap" aria-labelledby="hero-title">
      <div className="hero__copy">
        <h1 id="hero-title" className="display hero__title" lang={tagged}>
          <span className="hero__line">
            <span>{t('hero.line1')}</span>
          </span>{' '}
          <span className="hero__line hero__line--slab">
            <span className="hero__slab">{t('hero.line2')}</span>
          </span>
        </h1>
        <p className="lead hero__dek" lang={tagged}>
          {t('hero.dek')}
        </p>
        <div className="btn-row" lang={tagged}>
          <Link href="/app" className="btn" data-magnetic>
            {t('cta.send')}
          </Link>
          <Link href="/dojo" className="btn btn--ghost">
            {t('cta.dojo')}
          </Link>
        </div>
        <p className="hero__status small" lang={tagged}>
          <span className="pill" data-ink="ink">
            {t('status.devnet')}
          </span>
          <Link href={`/h/${exampleHold}`} className="more hero__receipt">
            {t('cta.receipt')}
            <Arrow />
          </Link>
        </p>
      </div>
      <BowlDemo windows={windows} />
    </section>
  );
}
