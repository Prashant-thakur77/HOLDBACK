import Link from 'next/link';

import { Bowl } from '@/components/art/Bowl';
import { Wordmark } from '@/components/art/Mark';
import { T } from '@/components/LangProvider';
import { explorerUrl } from '@/lib/cluster';
import { publicEnv } from '@/lib/env';
import { PROGRAM_ID, SITE_PAGES } from '@/lib/site';

/**
 * The footer: the small print set as short notices (each one a status a
 * careful reader would ask about), the page list, and the wordmark with its
 * O punched out, which closes the page the way the mark opened it.
 */
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <hr className="rule" data-reveal="rule" />
        <div className="site-footer__top">
          <section className="notices" aria-labelledby="small-print">
            <h2 id="small-print" className="notices__head label">
              Small print
            </h2>
            <ul className="notices__grid">
              <li>
                <b>Devnet.</b> The program runs on Solana devnet. Nothing here moves real money.
              </li>
              <li>
                <b>Unaudited.</b> The program has tests and a property test, and no audit yet.{' '}
                <Link href="/results" className="link">
                  What has run where
                </Link>
              </li>
              <li>
                <b>Program.</b>{' '}
                <a href={explorerUrl('address', PROGRAM_ID)} className="link mono" rel="noreferrer">
                  {PROGRAM_ID}
                </a>
              </li>
              <li>
                <b>Numbers.</b> Every figure on this site is read from data or code. External
                figures carry their source and scope.{' '}
                <Link href="/evidence" className="link">
                  How to check
                </Link>
              </li>
              <li>
                <b>Limits.</b> The window buys time and a warning. A sender who waits it out is not
                protected.{' '}
                <Link href="/how-it-works#limits" className="link">
                  All limits
                </Link>
              </li>
              <li>
                <b>Languages.</b> English, with the headline, the main actions and the warnings in
                Hindi, Spanish and Portuguese.
              </li>
            </ul>
          </section>

          <nav className="site-footer__nav" aria-label="All pages">
            <h2 className="label">Pages</h2>
            <ul>
              {SITE_PAGES.map((page) => (
                <li key={page.href}>
                  <Link href={page.href} data-ink={page.ink}>
                    <span className="patch" />
                    <T k={page.label} />
                    <span className="quiet small">{page.page}</span>
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/app" data-ink="ink">
                  <span className="patch" />
                  <T k="nav.app" />
                </Link>
              </li>
            </ul>
          </nav>

          <div className="site-footer__bowl" aria-hidden="true">
            <Bowl fill={0.35} state="floating" title="" />
          </div>
        </div>

        <p className="site-footer__mark" data-reveal="rise">
          <Wordmark punched />
        </p>
        <div className="site-footer__line small">
          <span>Every claim carries its receipt.</span>
          <span>MIT licence</span>
          <span className="mono">
            {publicEnv.cluster} · build {publicEnv.build.commit}
          </span>
        </div>
      </div>
    </footer>
  );
}
