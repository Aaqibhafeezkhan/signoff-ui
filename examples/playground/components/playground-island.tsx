'use client';

import dynamic from 'next/dynamic';
import { RunStart } from './run-start';

/*
 * The live run loads after the page: the AI SDK and the scripted agent are most of the home page's
 * JavaScript, and the first screen doesn't need them. Until then, a placeholder of the same shape
 * holds its place in the grid, the run not yet started, so nothing moves when the run arrives.
 */

const RunPlaceholder = () => (
  <>
    <div
      aria-hidden="true"
      className="border-line/80 bg-ink/85 sticky top-14 z-30 -mx-4 flex h-[53px] items-center border-y px-4 sm:-mx-6 sm:px-6 lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mx-0 lg:h-auto lg:flex-col lg:items-stretch lg:gap-4 lg:self-start lg:border-0 lg:bg-transparent lg:p-0"
    >
      <span className="bg-raised h-7 w-44 rounded-full lg:hidden" />
      <span className="border-line bg-raised/70 hidden h-[326px] rounded-xl border lg:block" />
      <span className="border-line bg-raised/70 hidden h-[270px] rounded-xl border lg:block" />
    </div>
    <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-2">
      {/* The repository's chips, or the run meter on a phone. */}
      <span className="h-[25px] sm:h-[27px]" />
      <RunStart />
    </div>
  </>
);

const Playground = dynamic(() => import('./playground').then((m) => m.Playground), {
  ssr: false,
  loading: RunPlaceholder,
});

export function PlaygroundIsland({ liveAvailable }: { liveAvailable: boolean }) {
  return <Playground liveAvailable={liveAvailable} />;
}
