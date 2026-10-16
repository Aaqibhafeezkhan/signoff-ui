import { PROMPT } from '@/lib/scenario';
import { PlayIcon, UserIcon } from './icons';

/**
 * Before the scripted run: the request it sends, and Play. The run's placeholder renders it too,
 * without Play's handler, so nothing moves when the run loads.
 */
export function RunStart({ onPlay }: { onPlay?: () => void }) {
  return (
    <section aria-label="Your request" className="border-line bg-raised/60 rounded-xl border px-4 py-3.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="bg-line text-fg-muted flex size-5 items-center justify-center rounded-full" aria-hidden="true">
          <UserIcon className="size-3" />
        </span>
        <span className="text-fg-muted text-[13px] font-medium">You</span>
      </div>
      <p className="text-fg text-[15px] leading-relaxed">{PROMPT}</p>
      <button
        type="button"
        onClick={onPlay}
        disabled={!onPlay}
        className="bg-cyan text-ink hover:bg-cyan-soft focus-visible:outline-fg mt-3.5 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default max-sm:w-full"
      >
        <PlayIcon className="size-4" />
        Play the run
      </button>
    </section>
  );
}
