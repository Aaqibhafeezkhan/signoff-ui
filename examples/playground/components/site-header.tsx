'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GITHUB_URL, NPM_URL } from '@/lib/site';
import { ArrowUpRightIcon, CloseIcon, GitHubIcon, MenuIcon, StarIcon } from './icons';
import { Logo } from './logo';
import { ThemeSwitch } from './theme-switch';

export type Page = 'docs' | 'components';

// The logo goes home, to the playground.
const PAGES: Array<{ page: Page; href: string; label: string }> = [
  { page: 'docs', href: '/docs', label: 'Docs' },
  { page: 'components', href: '/components', label: 'Components' },
];

const MENU_ID = 'site-menu';

// Its own chunk (with ondocs's styles), loaded only on a site that has Ask; still in the server's HTML.
const Ask = dynamic(() => import('./ask').then((m) => m.Ask));

const focusRing = 'focus-visible:outline-cyan-soft focus-visible:outline-2';
// No display: each button sets its own, so `hidden` on one doesn't compete with it.
const iconButton = `border-line text-fg-muted hover:border-line-strong hover:text-fg h-8 items-center justify-center gap-1.5 rounded-lg border transition-colors focus-visible:outline-offset-2 ${focusRing}`;

/**
 * The same header as the sibling sites: the name and version on the left; the pages, Ask, the
 * theme and GitHub on the right. Phones keep the name, the version and Ask, and the rest moves into
 * a menu.
 */
export function SiteHeader({
  page,
  version,
  stars,
  ask = false,
}: {
  page?: Page;
  version: string;
  /** Shown once there are enough to mean something (lib/stats.ts). */
  stars?: number;
  /** The Ask button and dialog (⌘K), when the server can answer (lib/ask.ts). On phones too, as an icon. */
  ask?: boolean;
}) {
  const pathname = usePathname();
  // The section's link is current on any page in it, and "page" on its own page.
  const current = (p: (typeof PAGES)[number]) =>
    page === p.page ? (pathname === p.href ? ('page' as const) : true) : undefined;
  const closeMenu = () => document.getElementById(MENU_ID)?.hidePopover();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const menu = document.getElementById(MENU_ID);
    const onToggle = (event: Event) => setMenuOpen((event as ToggleEvent).newState === 'open');
    menu?.addEventListener('toggle', onToggle);
    return () => menu?.removeEventListener('toggle', onToggle);
  }, []);
  const starLabel = stars === undefined ? '' : `, ${stars.toLocaleString('en')} stars`;
  const menuLink = `text-fg-muted hover:bg-raised hover:text-fg flex h-12 items-center rounded-lg px-3 text-[15px] focus-visible:-outline-offset-2 ${focusRing}`;

  return (
    <header className="border-line/80 bg-ink/95 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[1320px] items-center gap-2.5 px-4 sm:px-6">
        <Link href="/" className={`flex items-center gap-2.5 rounded-md focus-visible:outline-offset-4 ${focusRing}`}>
          <Logo />
          <span className="text-fg font-mono text-[13px] font-semibold tracking-tight">signoff-ui</span>
        </Link>
        <span
          data-version
          className="border-line text-fg-subtle rounded-full border px-1.5 py-px font-mono text-[11px] leading-4"
        >
          v{version}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <nav aria-label="Pages" className="mr-1 hidden items-center gap-1 md:flex">
            {PAGES.map((p) => (
              <Link
                key={p.page}
                href={p.href}
                aria-current={current(p)}
                className={`rounded-md px-2 py-1 text-[13px] transition-colors ${focusRing} ${page === p.page ? 'text-fg' : 'text-fg-muted hover:text-fg'}`}
              >
                {p.label}
              </Link>
            ))}
          </nav>
          {ask && <Ask />}
          <ThemeSwitch className="hidden md:flex" />
          <a
            href={GITHUB_URL}
            className={`${iconButton} hidden md:inline-flex ${stars === undefined ? 'w-8' : 'px-2.5'}`}
            aria-label={`signoff-ui on GitHub${starLabel}`}
          >
            <GitHubIcon className="size-4" />
            {stars !== undefined && (
              <span className="font-mono text-[12px] tabular-nums" aria-hidden="true">
                {stars.toLocaleString('en')}
              </span>
            )}
          </a>
          {/* Phones: everything but the name moves into a menu (a native popover: Escape and outside clicks close it). */}
          <button
            type="button"
            popoverTarget={MENU_ID}
            className={`${iconButton} tap-target relative inline-flex size-9 cursor-pointer md:hidden`}
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls={MENU_ID}
          >
            {menuOpen ? <CloseIcon className="size-4" /> : <MenuIcon className="size-4" />}
          </button>
        </div>
      </div>
      <nav
        id={MENU_ID}
        popover="auto"
        aria-label="Pages"
        className="border-line bg-ink text-fg inset-x-0 top-14 bottom-auto m-0 h-auto w-full max-w-none border-0 border-b p-0 shadow-[0_24px_48px_var(--site-shadow)] backdrop:bg-black/40 md:hidden"
      >
        <ul className="flex flex-col px-2 py-2">
          {PAGES.map((p) => (
            <li key={p.page}>
              <Link
                href={p.href}
                onClick={closeMenu}
                aria-current={current(p)}
                className={`${menuLink} aria-[current]:text-fg`}
              >
                {p.label}
                {page === p.page && <span className="bg-cyan ml-2 size-1.5 rounded-full" aria-hidden="true" />}
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-line mx-2 flex items-center justify-between border-t px-3 py-3">
          <span className="text-fg-muted text-[15px]" aria-hidden="true">
            Theme
          </span>
          <ThemeSwitch />
        </div>
        <ul className="border-line mx-2 flex flex-col border-t py-2">
          <li>
            <a href={GITHUB_URL} onClick={closeMenu} className={`${menuLink} justify-between`}>
              <span className="flex items-center gap-2">
                GitHub
                {stars !== undefined && (
                  <span className="text-fg-subtle flex items-center gap-1 font-mono text-[12px]">
                    <StarIcon className="size-3.5" />
                    {stars.toLocaleString('en')}
                    <span className="sr-only"> stars</span>
                  </span>
                )}
              </span>
              <ArrowUpRightIcon className="text-fg-subtle size-4" />
            </a>
          </li>
          <li>
            <a href={NPM_URL} onClick={closeMenu} className={`${menuLink} justify-between`}>
              npm
              <ArrowUpRightIcon className="text-fg-subtle size-4" />
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}
