'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { Heading } from '@/lib/docs';
import { ChevronDownIcon } from '../icons';
import { TOC_SLOT_ID } from './sidebar';

/** The section being read: the last heading above a line a fifth of the way down the screen. */
function useActiveHeading(headings: Heading[]) {
  const [active, setActive] = useState<string | undefined>(undefined);
  useEffect(() => {
    const elements = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => el !== null);
    const update = () => {
      const line = window.innerHeight * 0.2 + 56;
      let current: string | undefined;
      for (const el of elements) {
        if (el.getBoundingClientRect().top <= line) current = el.id;
        else break;
      }
      setActive(current ?? elements[0]?.id);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [headings]);
  return active;
}

function Links({ headings, active, onNavigate }: { headings: Heading[]; active?: string; onNavigate?: () => void }) {
  return (
    <ul className="border-line flex flex-col gap-1 border-l">
      {headings.map((h) => (
        <li key={h.id}>
          <a
            href={`#${h.id}`}
            onClick={onNavigate}
            aria-current={active === h.id ? 'location' : undefined}
            className={`focus-visible:outline-cyan-soft -ml-px block border-l py-1 leading-snug transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 ${
              h.depth === 3 ? 'pl-6' : 'pl-3'
            } ${active === h.id ? 'border-cyan text-fg' : 'text-fg-subtle hover:text-fg border-transparent'}`}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** "On this page" beside the page from 1024px: its sections, with the one being read marked as you scroll. */
export function TableOfContents({ headings }: { headings: Heading[] }) {
  const active = useActiveHeading(headings);
  if (headings.length === 0) return null;
  return (
    <nav aria-labelledby="toc-heading" className="text-[13px]">
      <p
        id="toc-heading"
        className="text-fg-subtle mb-3 font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase"
      >
        On this page
      </p>
      <Links headings={headings} active={active} />
    </nav>
  );
}

const MENU_ID = 'docs-toc-menu';
const noop = () => () => {};

/**
 * "On this page" under 1024px: a button in the docs bar (components/docs/sidebar.tsx) that opens the
 * page's sections. A native popover, so Escape and a click outside close it.
 */
export function TocMenu({ headings }: { headings: Heading[] }) {
  const active = useActiveHeading(headings);
  const slot = useSyncExternalStore(
    noop,
    () => document.getElementById(TOC_SLOT_ID),
    () => null,
  );
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const menu = document.getElementById(MENU_ID);
    const onToggle = (event: Event) => setOpen((event as ToggleEvent).newState === 'open');
    menu?.addEventListener('toggle', onToggle);
    return () => menu?.removeEventListener('toggle', onToggle);
  }, [slot]);
  if (!slot || headings.length === 0) return null;
  return createPortal(
    <>
      <button
        type="button"
        popoverTarget={MENU_ID}
        aria-expanded={open}
        aria-controls={MENU_ID}
        className="focus-visible:outline-cyan-soft text-fg-muted hover:text-fg -mr-1.5 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[13px] focus-visible:outline-2"
      >
        On this page
        <ChevronDownIcon
          className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <nav
        id={MENU_ID}
        popover="auto"
        aria-label="On this page"
        className="border-line bg-ink text-fg inset-x-0 top-[6.5rem] bottom-auto m-0 max-h-[calc(100dvh-8rem)] w-full max-w-none overflow-y-auto overscroll-contain border-0 border-b px-4 py-4 text-[14px] shadow-[0_24px_48px_var(--site-shadow)] backdrop:bg-black/30 sm:right-6 sm:left-auto sm:mt-1 sm:w-80 sm:rounded-xl sm:border sm:px-3"
      >
        <Links headings={headings} active={active} onNavigate={() => document.getElementById(MENU_ID)?.hidePopover()} />
      </nav>
    </>,
    slot,
  );
}
