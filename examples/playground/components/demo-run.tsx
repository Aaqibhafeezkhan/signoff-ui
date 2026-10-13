import type { ReactNode } from 'react';

/*
 * The pieces the AG-UI and ACP demos share around a scripted run: the prompt it sends, what the
 * run will do before it starts, and its Run and Reset buttons. In the library's tokens, since
 * the demos sit on its background.
 */

const button =
  'focus-visible:outline-signoff-ring inline-flex h-9 cursor-pointer items-center rounded-lg px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2';

export function RunButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${button} bg-signoff-accent text-signoff-on-accent hover:opacity-90`}
    >
      {children}
    </button>
  );
}

export function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${button} border-signoff-border text-signoff-fg-muted hover:border-signoff-border-strong hover:text-signoff-fg ml-auto border font-normal`}
    >
      Reset
    </button>
  );
}

/** The prompt the run sends, as the person's message. */
export function Prompt({ children }: { children: ReactNode }) {
  return (
    <p className="bg-signoff-surface text-signoff-fg rounded-lg px-3 py-2 text-[13px] leading-snug">
      <span className="text-signoff-fg-subtle mr-2 font-mono text-[10.5px] tracking-[0.08em] uppercase">You</span>
      {children}
    </p>
  );
}

/** Before the run starts: its steps in order, so the frame isn't empty and says what Run will show. */
export function RunPlan({ label, steps }: { label: string; steps: Array<{ name: string; note: string }> }) {
  return (
    <div className="border-signoff-border rounded-lg border border-dashed px-4 py-3.5">
      <p className="text-signoff-fg-subtle font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase">{label}</p>
      <ol className="mt-2.5 flex flex-col gap-2 text-[13px] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
        {steps.map((step, i) => (
          <li key={step.name} className="flex items-center gap-2">
            {i > 0 && (
              <span className="text-signoff-fg-subtle max-sm:hidden" aria-hidden="true">
                →
              </span>
            )}
            <span className="border-signoff-border bg-signoff-surface text-signoff-fg rounded-md border px-2 py-0.5 font-mono text-[12px]">
              {step.name}
            </span>
            <span className="text-signoff-fg-muted">{step.note}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
