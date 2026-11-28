'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { StoryMotion } from '@/components/motion/StoryMotion';
import { translate } from '@/lib/i18n';
import { isBareRoute, isStoryRoute, pageFor, type SitePage } from '@/lib/site';

interface Props {
  header: ReactNode;
  footer: ReactNode;
  /** The quiet footer for app screens and dead ends. */
  slimFooter: ReactNode;
  children: ReactNode;
}

/** How long the sheet takes to cover the page before the route changes. */
const COVER_MS = 300;

/** A same-origin link click that should become a page turn. */
function internalTarget(event: MouseEvent): URL | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.('a');
  if (!anchor || anchor.target || anchor.hasAttribute('download')) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  if (url.pathname === window.location.pathname) return null;
  return url;
}

/**
 * The shell around every page: header, footer, scroll reveals and the page
 * turn. The spectator page is embedded in a frame and renders bare.
 *
 * The page turn is a sheet of paper that slides up over the page, carrying
 * the next page's ink patch and number, and slides away once the next page
 * has rendered, where that page's own opening picks up. It runs only between
 * story pages; the app screens change plainly.
 *
 * Motion here only ever adds to a page that is already readable: reveal start
 * states apply under `html.js`, and the page turn is skipped when the reader
 * prefers reduced motion.
 */
export function SiteChrome({ header, footer, slimFooter, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [turn, setTurn] = useState<{ page: SitePage; phase: 'cover' | 'leave' } | null>(null);
  const turning = useRef(false);

  // Reveal elements once, when they arrive on screen.
  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)');
    if (!('IntersectionObserver' in window)) {
      targets.forEach((element) => element.classList.add('is-in'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    targets.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pathname]);

  // The intro plays once, on the page the visitor arrived at.
  useEffect(() => {
    const done = window.setTimeout(
      () => document.documentElement.classList.remove('intro-run'),
      2400,
    );
    return () => window.clearTimeout(done);
  }, []);

  // The new page has rendered: let the sheet slide away.
  useEffect(() => {
    if (!turning.current) return;
    turning.current = false;
    setTurn((current) => (current ? { ...current, phase: 'leave' } : null));
    const done = window.setTimeout(() => setTurn(null), 520);
    return () => window.clearTimeout(done);
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const url = internalTarget(event);
      const page = url ? pageFor(url.pathname) : null;
      // Between story pages only: the app screens and the proof table change plainly.
      if (!url || !page) return;
      if (!isStoryRoute(url.pathname) || !isStoryRoute(window.location.pathname)) return;
      event.preventDefault();
      if (turning.current) return;
      turning.current = true;
      setTurn({ page, phase: 'cover' });
      window.setTimeout(() => router.push(url.pathname + url.search + url.hash), COVER_MS);
      // A page that fails to arrive must not leave the sheet over the screen.
      window.setTimeout(() => {
        if (!turning.current) return;
        turning.current = false;
        setTurn(null);
      }, 5000);
    };
    // Capture phase, so the framework's own link handler sees the event as handled.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [router]);

  if (isBareRoute(pathname)) return <>{children}</>;
  return (
    <>
      <a className="skip" href="#content">
        Skip to the content
      </a>
      {header}
      <div id="content" className="page">
        {children}
      </div>
      {pageFor(pathname) && isStoryRoute(pathname) ? footer : slimFooter}
      {isStoryRoute(pathname) ? <StoryMotion pathname={pathname} /> : null}
      {turn ? (
        <div className={`turn is-${turn.phase}`} data-ink={turn.page.ink} aria-hidden="true">
          <div className="turn__sheet">
            <span className="turn__patch" />
            <span className="turn__page label">Page {turn.page.page}</span>
            <span className="turn__name">{translate('en', turn.page.label)}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
