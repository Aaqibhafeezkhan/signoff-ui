'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A docs table that scrolls sideways when it is wider than the page: a named region in the tab
 * order, so the arrow keys scroll it (axe's scrollable-region-focusable), with its right edge faded
 * while more of it is out of view.
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);
  return (
    <div className="table-wrap">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region the keyboard must reach */}
      <div ref={ref} role="region" aria-label={label} tabIndex={0} data-more={more || undefined}>
        {children}
      </div>
    </div>
  );
}
