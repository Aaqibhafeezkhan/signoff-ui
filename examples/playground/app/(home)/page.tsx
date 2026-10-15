import kit from 'signoff-ui/package.json';
import { HighlightedFilesProvider } from '@/components/file-output';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { Hero, HeroProof } from '@/components/hero';
import { Landing } from '@/components/landing';
import { PlaygroundIsland } from '@/components/playground-island';
import { SignoffFrame } from '@/components/signoff-frame';
import { highlightFiles, PLAYGROUND_FILES } from '@/lib/demo-code';
import { liveModeEnabled } from '@/lib/live';
import { pageMetadata } from '@/lib/metadata';
import { AUTHOR, GITHUB_URL, NPM_URL, PACKAGE, SITE_URL, TAGLINE } from '@/lib/site';

export const metadata = pageMetadata({
  // "signoff-ui: review what your agent changed and approve what it may do"
  title: `${PACKAGE}: ${TAGLINE.charAt(0).toLowerCase()}${TAGLINE.slice(1, -1)}`,
  // The pitch after the tagline, as in the README and on npm, less one clause: search results show
  // about 160 characters.
  description:
    'React components for multi-file diff review and tool approvals, for AI SDK 6 & 7, AG-UI and ACP agents, inside assistant-ui, AI Elements or your own chat.',
  path: '/',
});

// What search engines read about the project (schema.org), with the version this site was built with.
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareSourceCode',
  name: PACKAGE,
  description: TAGLINE,
  url: SITE_URL,
  codeRepository: GITHUB_URL,
  sameAs: [NPM_URL],
  programmingLanguage: 'TypeScript',
  runtimePlatform: 'React 18, React 19',
  license: 'https://opensource.org/licenses/MIT',
  version: kit.version,
  author: { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url },
};

export default async function Page() {
  // The files the scripted agent reads, highlighted now rather than in the browser.
  const files = await highlightFiles(PLAYGROUND_FILES);
  return (
    <div className="min-h-dvh">
      <script
        type="application/ld+json"
        // JSON in a script element: escape `<` so no string in it can close the element.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, '\\u003c') }}
      />
      <Header />
      <div className="grid-backdrop pointer-events-none fixed inset-x-0 top-0 -z-10 h-[70vh]" aria-hidden="true" />
      <main id="main">
        {/*
         * The first screen: what the kit is for and how to start on the left, under it the panel that
         * prints what goes back to the agent, then what it works with and the proof; the review and
         * the approval on the right, live but still (components/signoff-frame.tsx). Phones: the
         * headline and the calls to action, the components, the panel, then the rest.
         */}
        <div className="mx-auto grid w-full max-w-[1320px] gap-8 px-4 pt-7 sm:px-6 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:grid-rows-[auto_auto_1fr] lg:gap-x-12 lg:gap-y-6 lg:pt-8">
          <div className="lg:col-start-1 lg:row-start-1">
            <Hero />
          </div>
          <SignoffFrame />
          <div className="lg:col-start-1 lg:row-start-3">
            <HeroProof />
          </div>
        </div>
        {/*
         * The scripted run, which starts when it's asked for: "Watch a full run" (#run) or its own
         * Play. Phones: the heading, a sticky bar with the status and playback, then the conversation;
         * the rest of the controls open in a sheet. Wide screens: the heading and the run on the left,
         * the status, controls and telemetry in a sticky sidebar. Flex on phones so the bar can stick
         * for the whole run (a grid item only sticks within its own row). The sidebar spans both rows;
         * the second row takes its extra height, so the run doesn't move once it outgrows the sidebar.
         */}
        <section
          id="run"
          aria-labelledby="run-heading"
          className="mx-auto mt-14 w-full max-w-[1320px] scroll-mt-14 px-4 sm:mt-20 sm:px-6"
        >
          <div className="border-line/70 flex flex-col gap-6 border-t pt-14 sm:pt-20 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-6">
            <div className="lg:col-start-1 lg:row-start-1">
              <p className="text-fg-subtle font-mono text-[11px] font-medium tracking-[0.08em] uppercase">
                Live demo · no API key
              </p>
              <h2
                id="run-heading"
                className="text-fg-strong mt-3 text-[24px] leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]"
              >
                Watch a full run
              </h2>
              <p className="text-fg-muted mt-3 max-w-2xl text-[15px] leading-relaxed text-pretty">
                A scripted coding agent adds rate limiting to a Next.js route: it asks before it installs a package,
                then hands you its edit to review. Every panel is a kit component.
              </p>
            </div>
            {/* Live mode is offered only when the server opts in (lib/live.ts); the scripted run is always the default. */}
            <HighlightedFilesProvider files={files}>
              <PlaygroundIsland liveAvailable={liveModeEnabled()} />
            </HighlightedFilesProvider>
          </div>
        </section>
        <Landing />
      </main>
      <Footer />
    </div>
  );
}
