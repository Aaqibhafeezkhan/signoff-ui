'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CopyButton } from '../copy-button';
import { PromptLine } from '../terminal';
import { CheckIcon, CopyIcon } from '../icons';

/** Copies the code block it sits in, read from the page, so the code isn't sent twice. It sits in the block's bar. */
export function CopyCodeButton() {
  const ref = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const id = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(id);
  }, [state]);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label="Copy code"
        title="Copy code"
        onClick={() => {
          const text = ref.current?.closest('[data-code-block]')?.querySelector('pre')?.innerText ?? '';
          navigator.clipboard.writeText(text.replace(/\n$/, '')).then(
            () => setState('copied'),
            () => setState('failed'),
          );
        }}
        className="tap-target focus-visible:outline-cyan-soft text-fg-muted hover:bg-line hover:text-fg absolute top-1 right-1.5 inline-flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-1"
      >
        {state === 'copied' ? <CheckIcon className="text-cyan-soft size-4" /> : <CopyIcon className="size-4" />}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copying failed: select the code instead' : ''}
      </span>
    </>
  );
}

/**
 * Highlighted code that marks itself while more of it is out of view to the right, for the fade:
 * Shiki's HTML from the build, or a `<pre>` rendered here (components/terminal.tsx).
 */
export function CodeScroll({
  html,
  children,
  className = '',
}: {
  html?: string;
  children?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const pre = ref.current?.querySelector('pre');
    if (!pre) return;
    const update = () => setMore(pre.scrollLeft + pre.clientWidth < pre.scrollWidth - 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(pre);
    pre.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      pre.removeEventListener('scroll', update);
    };
  }, []);
  if (html === undefined) {
    return (
      <div ref={ref} className={`code-scroll ${className}`} data-more={more || undefined}>
        {children}
      </div>
    );
  }
  return (
    <div ref={ref} className="code-scroll" data-more={more || undefined} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
type Manager = (typeof MANAGERS)[number];

/** The same command for each package manager, from the npm form (`npm i x` or `npx y`). */
function commandFor(manager: Manager, npm: string) {
  const install = /^npm i(?:nstall)? (.+)$/.exec(npm);
  if (install) return manager === 'npm' ? npm : `${manager} add ${install[1]}`;
  const exec = /^npx (.+)$/.exec(npm);
  if (exec) {
    const rest = exec[1]!;
    return { npm, pnpm: `pnpm dlx ${rest}`, yarn: `yarn ${rest}`, bun: `bunx --bun ${rest}` }[manager];
  }
  return npm;
}

// The chosen package manager, shared by every install block on the page and remembered.
const STORAGE_KEY = 'signoff-package-manager';
const listeners = new Set<() => void>();
let current: Manager | undefined;
function readManager(): Manager {
  if (current) return current;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (MANAGERS as readonly string[]).includes(stored)) current = stored as Manager;
  } catch {
    // Storage can be unavailable (private windows, blocked site data); npm it is.
  }
  return current ?? 'npm';
}
function setManager(manager: Manager) {
  current = manager;
  try {
    localStorage.setItem(STORAGE_KEY, manager);
  } catch {
    // Not remembered, still applied.
  }
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** An install command with tabs for npm, pnpm, yarn and bun. */
export function PackageInstall({ command }: { command: string }) {
  const manager = useSyncExternalStore(subscribe, readManager, () => 'npm' as Manager);
  const id = useId();
  const text = commandFor(manager, command);
  return (
    <div className="code-block">
      <div className="border-line flex items-center border-b px-2" role="tablist" aria-label="Package manager">
        {MANAGERS.map((m, i) => (
          <button
            key={m}
            id={`${id}-${m}`}
            type="button"
            role="tab"
            aria-selected={manager === m}
            aria-controls={`${id}-panel`}
            tabIndex={manager === m ? 0 : -1}
            onClick={() => setManager(m)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const next = MANAGERS[(i + step + MANAGERS.length) % MANAGERS.length]!;
              setManager(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }}
            className={`tap-target focus-visible:outline-cyan-soft relative -mb-px cursor-pointer border-b-2 px-2.5 py-2 font-mono text-[12px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 ${
              manager === m ? 'border-cyan text-fg' : 'text-fg-subtle hover:text-fg border-transparent'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${manager}`}
        className="flex items-center gap-2 py-1.5 pr-1.5 pl-4"
      >
        {/* A command is code: it scrolls, faded at the right edge, rather than wrapping. Copy takes it without the prompt. */}
        <CodeScroll key={text} className="min-w-0 flex-1">
          <pre className="term command-pre" role="group" aria-label={`The ${manager} command`} tabIndex={0}>
            <code>
              <PromptLine command={text} />
            </code>
          </pre>
        </CodeScroll>
        <CopyButton text={text} label={`Copy the ${manager} command`} />
      </div>
    </div>
  );
}
