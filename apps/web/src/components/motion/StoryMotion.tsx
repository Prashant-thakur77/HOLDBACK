'use client';

import { useEffect } from 'react';

/**
 * The richer motion of the story pages: smooth scroll, headings whose lines
 * rise from a mask, figures that count up, and buttons that lean toward the
 * pointer. It renders nothing.
 *
 * The animation libraries are imported inside the effect, after the page is
 * interactive, so they are never part of a first bundle and never load on
 * the app screens (this component is not mounted there). With reduced motion
 * nothing is imported at all: the page is already complete without it.
 */
export function StoryMotion({ pathname }: { pathname: string }) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const start = async () => {
      const [{ gsap }, { ScrollTrigger }, { SplitText }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
        import('gsap/SplitText'),
      ]);
      // Lines are measured, so the real fonts have to be in place first.
      await document.fonts.ready;
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger, SplitText);
      const undo: (() => void)[] = [];

      // Smooth scroll on wide, pointer-driven screens. Phones keep native scrolling.
      if (window.matchMedia('(min-width: 1180px) and (pointer: fine)').matches) {
        const { default: Lenis } = await import('lenis');
        if (cancelled) return;
        // Anchor links stop below the fixed header.
        const lenis = new Lenis({ lerp: 0.12, anchors: { offset: -80 } });
        lenis.on('scroll', ScrollTrigger.update);
        const tick = (time: number) => lenis.raf(time * 1000);
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);
        undo.push(() => {
          gsap.ticker.remove(tick);
          lenis.destroy();
        });
      }

      const context = gsap.context(() => {
        // Headings below the first screen: each line rises out of its own mask.
        document.querySelectorAll<HTMLElement>('[data-split]').forEach((heading) => {
          if (heading.getBoundingClientRect().top < window.innerHeight * 0.9) return;
          // `aria: 'none'`: the lines stay real text, so no label is forced onto the element.
          const split = SplitText.create(heading, { type: 'lines', mask: 'lines', aria: 'none' });
          gsap.from(split.lines, {
            yPercent: 105,
            duration: 0.7,
            ease: 'power3.out',
            stagger: 0.07,
            scrollTrigger: { trigger: heading, start: 'top 88%', once: true },
            onComplete: () => split.revert(),
          });
        });

        // Figures count up to the value already printed in the page.
        document.querySelectorAll<HTMLElement>('[data-count]').forEach((figure) => {
          const target = Number(figure.dataset.count);
          const printed = figure.textContent ?? '';
          if (!Number.isFinite(target) || target === 0) return;
          if (figure.getBoundingClientRect().top < window.innerHeight * 0.6) return;
          const prefix = printed.match(/^[^\d]*/)?.[0] ?? '';
          const suffix = printed.match(/[^\d]*$/)?.[0] ?? '';
          const state = { value: 0 };
          gsap.to(state, {
            value: target,
            duration: 1.1,
            ease: 'power2.out',
            scrollTrigger: { trigger: figure, start: 'top 90%', once: true },
            onUpdate: () => {
              figure.textContent = `${prefix}${Math.round(state.value).toLocaleString('en-US')}${suffix}`;
            },
            onComplete: () => {
              figure.textContent = printed;
            },
          });
        });
      });
      undo.push(() => context.revert());

      // Primary buttons lean a little toward a fine pointer, and settle without a bounce.
      if (window.matchMedia('(pointer: fine)').matches) {
        document.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((button) => {
          const move = (event: PointerEvent) => {
            const box = button.getBoundingClientRect();
            const x = (event.clientX - (box.left + box.width / 2)) * 0.22;
            const y = (event.clientY - (box.top + box.height / 2)) * 0.3;
            gsap.to(button, { x, y, duration: 0.25, ease: 'power3.out', overwrite: true });
          };
          const leave = () =>
            gsap.to(button, { x: 0, y: 0, duration: 0.42, ease: 'power3.out', overwrite: true });
          button.addEventListener('pointermove', move);
          button.addEventListener('pointerleave', leave);
          undo.push(() => {
            button.removeEventListener('pointermove', move);
            button.removeEventListener('pointerleave', leave);
            gsap.set(button, { clearProps: 'transform' });
          });
        });
      }

      ScrollTrigger.refresh();
      cleanup = () => undo.forEach((step) => step());
    };

    // After first paint and hydration, when the browser has a moment.
    const whenIdle =
      'requestIdleCallback' in window
        ? (run: () => void) => window.requestIdleCallback(run, { timeout: 1500 })
        : (run: () => void) => window.setTimeout(run, 400);
    whenIdle(() => {
      if (!cancelled) void start();
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [pathname]);

  return null;
}
