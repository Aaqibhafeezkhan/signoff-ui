'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { SITE_URL } from '@/lib/site';
import { ArrowUpRightIcon, CheckIcon, ChevronDownIcon, CopyIcon } from '../icons';

/**
 * The page's actions: copy it as Markdown, read it as Markdown, or hand it to ChatGPT or Claude.
 * "Copy page" is a button of its own; the arrow beside it opens all four. The Markdown is served at
 * `<page>.md`; the chat links pass its public URL, so the assistant reads the same text.
 */
export function PageActions({ markdownPath }: { markdownPath: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (state === 'idle') return;
    const id = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(id);
  }, [state]);

  // Closes on Escape (back to the arrow), a click outside, or focus moving out.
  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) => !(target instanceof Node && root.current?.contains(target));
    const onPointerDown = (event: PointerEvent) => outside(event.target) && setOpen(false);
    const onFocusIn = (event: FocusEvent) => outside(event.target) && setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const copy = async () => {
    const text = fetch(markdownPath).then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.text();
    });
    try {
      // Safari only allows the write within the click, so hand it the pending text.
      if (typeof ClipboardItem !== 'undefined' && 'write' in navigator.clipboard) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) }),
        ]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  const prompt = `Read ${SITE_URL}${markdownPath} so I can ask questions about it.`;
  const links = [
    { label: 'View as Markdown', note: 'This page as plain text', href: markdownPath },
    {
      label: 'Open in ChatGPT',
      note: 'Ask questions about this page',
      href: `https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}`,
    },
    {
      label: 'Open in Claude',
      note: 'Ask questions about this page',
      href: `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
    },
  ];
  const part =
    'focus-visible:outline-cyan-soft inline-flex h-8 cursor-pointer items-center gap-1.5 text-[12.5px] font-medium text-fg-soft transition-colors hover:bg-raised hover:text-fg-strong focus-visible:outline-2 focus-visible:outline-offset-2';
  const item =
    'focus-visible:outline-cyan-soft flex w-full cursor-pointer flex-col items-start rounded-md px-2.5 py-2 text-left transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2';

  return (
    <div ref={root} className="relative inline-flex">
      <div className="border-line bg-surface inline-flex overflow-visible rounded-md border">
        <button type="button" onClick={() => void copy()} className={`${part} rounded-l-md px-2.5`}>
          {state === 'copied' ? <CheckIcon className="text-cyan-soft size-3.5" /> : <CopyIcon className="size-3.5" />}
          {state === 'copied' ? (
            'Copied'
          ) : (
            <span>
              Copy page<span className="sr-only"> as Markdown</span>
            </span>
          )}
        </button>
        <button
          ref={toggle}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={menuId}
          aria-label="More page actions"
          className={`${part} border-line rounded-r-md border-l px-2`}
        >
          <ChevronDownIcon
            className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Page copied as Markdown' : state === 'failed' ? 'Copying failed' : ''}
      </span>
      {open && (
        <ul
          id={menuId}
          aria-label="Page actions"
          className="border-line bg-surface absolute top-full left-0 z-20 mt-1.5 flex w-64 flex-col gap-0.5 rounded-lg border p-1 shadow-[0_16px_40px_var(--site-shadow)]"
        >
          <li>
            <button
              type="button"
              className={item}
              onClick={() => {
                setOpen(false);
                void copy();
              }}
            >
              <span className="text-fg text-[13px] font-medium">Copy page as Markdown</span>
              <span className="text-fg-subtle text-[12px]">For an LLM or your notes</span>
            </button>
          </li>
          {links.map((link) => {
            const external = link.href.startsWith('http');
            return (
              <li key={link.label}>
                <a
                  href={link.href}
                  className={item}
                  onClick={() => setOpen(false)}
                  {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                >
                  <span className="text-fg flex items-center gap-1 text-[13px] font-medium">
                    {link.label}
                    {external && (
                      <>
                        <ArrowUpRightIcon className="text-fg-subtle size-3" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </>
                    )}
                  </span>
                  <span className="text-fg-subtle text-[12px]">{link.note}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
