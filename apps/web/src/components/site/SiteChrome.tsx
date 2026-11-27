'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

import { isBareRoute } from '@/lib/site';

interface Props {
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

/** A same-origin link click that should become a page turn. */
function internalTarget(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.('a');
  if (!anchor || anchor.target || anchor.hasAttribute('download')) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  if (url.pathname === window.location.pathname) return null;
  if (url.pathname.startsWith('/api/')) return null;
  return url.pathname + url.search + url.hash;
}

/**
 * The shell around every page: header, footer, scroll reveals and the page
 * turn. The spectator page is embedded in a frame and renders bare.
 *
 * Motion here only ever adds to a page that is already readable: reveal start
 * states apply under `html.js`, and the page turn is skipped where the View
 * Transitions API is missing or the reader prefers reduced motion.
 */
export function SiteChrome({ header, footer, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const finishTurn = useRef<(() => void) | null>(null);

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

  // The new page has rendered: let the page turn finish.
  useEffect(() => {
    finishTurn.current?.();
    finishTurn.current = null;
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!document.startViewTransition) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const target = internalTarget(event);
      if (!target) return;
      event.preventDefault();
      document.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            finishTurn.current = resolve;
            // A slow page must not hold the screen: the turn ends regardless.
            window.setTimeout(resolve, 1200);
            router.push(target);
          }),
      );
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
      {footer}
    </>
  );
}
