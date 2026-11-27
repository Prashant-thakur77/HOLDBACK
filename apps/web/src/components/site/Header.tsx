'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Mark, Wordmark } from '@/components/art/Mark';
import { T, useLang } from '@/components/LangProvider';
import { LANG_NAMES, SITE_LANGS } from '@/lib/i18n';
import { SITE_PAGES } from '@/lib/site';

function isCurrent(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** The language switch: four plain buttons, each written in its own language. */
function LangSwitch({ id }: { id: string }) {
  const { lang, setLang } = useLang();
  return (
    <div className="lang" role="group" aria-label="Language">
      {SITE_LANGS.map((code) => (
        <button
          key={code}
          type="button"
          id={`${id}-${code}`}
          lang={code}
          className="lang__btn"
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
        >
          <span className="lang__short" aria-hidden="true">
            {code === 'hi' ? 'हिं' : code.toUpperCase()}
          </span>
          <span className="visually-hidden">{LANG_NAMES[code]}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The site header. On wide screens the pages are a row of ink patches, one
 * per page. On narrow screens the same list opens as a contents sheet that
 * slides up like paper: focus stays inside it, Escape closes it and the page
 * behind does not scroll.
 */
export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  // A new page closes the sheet.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Hide while reading down, return on the way up.
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setHidden(y > last && y > 160);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheet?.querySelector<HTMLElement>('a')?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close(true);
        return;
      }
      if (event.key !== 'Tab' || !sheet) return;
      // The header button is the sheet's only close control, so it joins the loop.
      const items = [
        ...(toggleRef.current ? [toggleRef.current] : []),
        ...sheet.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      ];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <>
      <header className={`site-header${hidden && !open ? ' is-hidden' : ''}`}>
        <div className="wrap site-header__bar">
          <Link href="/" className="site-header__brand" aria-label="HOLDBACK, home">
            <Mark size={34} />
            <Wordmark />
          </Link>

          <nav className="patches" aria-label="Pages">
            <ul>
              {SITE_PAGES.map((page) => (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    data-ink={page.ink}
                    aria-current={isCurrent(pathname, page.href) ? 'page' : undefined}
                  >
                    <span className="patches__patch" />
                    <span className="patches__label">
                      <T k={page.label} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="site-header__tools">
            <LangSwitch id="lang-bar" />
            <Link href="/app" className="btn btn--sm site-header__app">
              <T k="nav.app" />
            </Link>
            <button
              ref={toggleRef}
              type="button"
              className="site-header__toggle"
              aria-expanded={open}
              aria-controls="contents-sheet"
              onClick={() => setOpen((value) => !value)}
            >
              <span className="site-header__toggle-mark" aria-hidden="true" />
              <T k={open ? 'nav.close' : 'nav.contents'} />
            </button>
          </div>
        </div>
      </header>

      <div
        id="contents-sheet"
        ref={sheetRef}
        className={`sheet${open ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Contents"
        hidden={!open}
      >
        <div className="wrap sheet__inner">
          <p className="sheet__head label">
            <T k="nav.contents" />
          </p>
          <ol className="sheet__list">
            {SITE_PAGES.map((page, index) => (
              <li key={page.href} style={{ ['--i' as string]: index }}>
                <Link
                  href={page.href}
                  data-ink={page.ink}
                  aria-current={isCurrent(pathname, page.href) ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span className="patch" />
                  <span className="sheet__title">
                    <T k={page.label} />
                  </span>
                  <span className="sheet__page label">Page {page.page}</span>
                  <span className="sheet__summary">{page.summary}</span>
                </Link>
              </li>
            ))}
          </ol>
          <div className="sheet__foot">
            <LangSwitch id="lang-sheet" />
            <Link href="/app" className="btn" onClick={() => setOpen(false)}>
              <T k="nav.app" />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
