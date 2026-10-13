import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { DEMOS, LabelsDemo } from '@/components/demos';
import AcpDemo from '@/components/acp-demo';
import { ThemingDemo } from '@/components/demos/theming';
import { ComponentInstall } from '@/components/docs/component-install';
import { HighlightedFilesProvider } from '@/components/file-output';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { ArrowRightIcon } from '@/components/icons';
import { componentHref, getComponent } from '@/lib/components';
import { ACP_FILES, AG_UI_FILES, highlightFiles } from '@/lib/demo-code';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: 'Components · signoff-ui',
  description:
    'Every signoff-ui component in isolation, from diff review and approval rules to an AG-UI agent and an ACP turn, with npm and shadcn install snippets.',
  path: '/components',
});

// Page order; each id is the section's anchor, which launch posts and the README link to.
interface GallerySection {
  id: string;
  /** The jump link's name, when the heading isn't a component's (`<DiffReview />` reads DiffReview). */
  short?: string;
  /** The component's docs slug; without one, `guide` says where the section's docs are. */
  slug?: string;
  heading: string;
  description: ReactNode;
  guide?: { href: string; name: string; link: string; Demo: ComponentType };
}

const SECTIONS: GallerySection[] = [
  {
    id: 'diff-review',
    slug: 'diff-review',
    heading: '<DiffReview />',
    description:
      'Accept or reject agent edits hunk by hunk or file by file, comment on lines, and send the agent what you applied, rejected and said. Large files are diffed in a worker and render only what is near the screen.',
  },
  {
    id: 'use-diff-review',
    slug: 'use-diff-review',
    heading: 'useDiffReview(options)',
    description:
      'The same review in markup of its own: this list uses the site’s classes and none of the kit’s, and the hook brings the keyboard, decisions, comments and the result.',
  },
  {
    id: 'approval-card',
    slug: 'approval-card',
    heading: '<ApprovalCard />',
    description:
      'Approve or deny a tool call once, for the session or always, with what will run, its risk, the arguments editable first, a reason and a key for each choice.',
  },
  {
    id: 'use-approval-policy',
    slug: 'use-approval-policy',
    heading: 'useApprovalPolicy()',
    description:
      'Approval rules: answer once, for this session or always, by tool and argument pattern. The next call a rule covers is answered without asking, and every decision goes to the audit trail.',
  },
  {
    id: 'tool-call-timeline',
    slug: 'tool-call-timeline',
    heading: '<ToolCallTimeline />',
    description: 'Every tool state with durations, a waterfall, and expandable input and output.',
  },
  {
    id: 'agent-status',
    slug: 'agent-status',
    heading: '<AgentStatus />',
    description: 'Run state in one pill, announced through a live region.',
  },
  {
    id: 'run-meter',
    slug: 'run-meter',
    heading: '<RunMeter />',
    description: 'Tokens, estimated cost and latency; compact for headers, expanded for panels.',
  },
  {
    id: 'sources',
    slug: 'sources',
    heading: '<Sources />',
    description: 'Citations as compact chips or cards; inline [n] markers link to them.',
  },
  {
    id: 'theming',
    heading: 'Theming',
    description:
      'Every color, radius and font is a CSS variable. Light is the default, .dark switches, and any subtree can override tokens.',
    guide: { href: '/docs/getting-started#theming', name: 'theming', link: 'Theming docs', Demo: ThemingDemo },
  },
  {
    id: 'labels',
    heading: 'Labels',
    description:
      'Every word the components show or announce is a label. Here the approval and the review are in Portuguese, from one SignoffLabelsProvider.',
    guide: { href: '/docs/labels', name: 'labels', link: 'Labels docs', Demo: LabelsDemo },
  },
  {
    id: 'agent-message',
    slug: 'agent-message',
    heading: '<AgentMessage />',
    description: 'A whole assistant UIMessage: reasoning, streaming markdown, grouped tool calls and sources.',
  },
  {
    id: 'markdown',
    slug: 'markdown',
    heading: '<Markdown />',
    description: 'Streaming-safe markdown: syntax that hasn’t closed yet never flashes raw, and no raw HTML.',
  },
  {
    id: 'reasoning',
    slug: 'reasoning',
    heading: '<Reasoning />',
    description: 'Open while the model thinks, then one line: “Thought for 1.7s”.',
  },
  {
    id: 'ag-ui',
    slug: 'use-ag-ui-agent',
    heading: 'useAgUiAgent(agent)',
    description: (
      <>
        AG-UI agents (LangGraph, CrewAI, Mastra, Pydantic AI) through the same components. This one is a real{' '}
        <span className="whitespace-nowrap">@ag-ui/client</span> agent replaying a LangGraph-style run: steps, streamed
        tool arguments, and an interrupt that resumes the run when you answer it.
      </>
    ),
  },
  {
    id: 'acp',
    short: 'ACP',
    heading: 'Agent Client Protocol',
    description:
      'An ACP prompt turn through the same components, with signoff-ui/acp: a scripted agent sends its session updates and asks permission to edit a file, whose diff the card shows, and to run the tests. The card offers the options the agent sent.',
    guide: { href: '/docs/acp', name: 'the Agent Client Protocol', link: 'ACP docs', Demo: AcpDemo },
  },
];

function Section({ id, slug, heading, description, guide }: GallerySection) {
  const component = slug ? getComponent(slug) : undefined;
  const Demo = slug ? DEMOS[slug] : guide?.Demo;
  const docs = component ? componentHref(component.slug) : (guide?.href ?? '/docs');
  const frame: ReactNode = (
    <div data-shot={id} className="border-signoff-border bg-signoff-bg rounded-2xl border p-3 sm:p-6">
      {Demo ? <Demo /> : null}
    </div>
  );
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-fg-strong font-mono text-[17px] font-semibold sm:text-[18px]">
            {heading}
          </h2>
          <p className="text-fg-muted mt-1.5 max-w-2xl text-[14px] leading-relaxed">{description}</p>
        </div>
        <Link
          href={docs}
          className="text-cyan-soft focus-visible:outline-cyan-soft inline-flex items-center gap-1 rounded-sm text-[13px] font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {component ? 'Docs and props' : guide?.link}
          <span className="sr-only"> for {component?.name ?? guide?.name}</span>
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>
      {frame}
      {component && (
        <div className="mt-3">
          <ComponentInstall component={component} />
        </div>
      )}
    </section>
  );
}

export default async function GalleryPage() {
  // The files the AG-UI and ACP demos' agents read, highlighted now rather than in the browser.
  const files = await highlightFiles([...AG_UI_FILES, ...ACP_FILES]);
  return (
    <div className="min-h-dvh">
      <Header page="components" />
      <main id="main" className="mx-auto w-full max-w-[1000px] px-4 pt-8 pb-24 sm:px-6 lg:pt-12">
        <div className="max-w-2xl">
          <h1 className="text-fg-strong text-[30px] leading-tight font-semibold tracking-[-0.025em] sm:text-[36px]">
            Components
          </h1>
          <p className="text-fg-muted mt-3 text-[16px] leading-relaxed text-pretty sm:text-[17px]">
            Each component on its own, live and keyboard accessible, with its npm and shadcn install. Its docs page has
            the props, keys and theming hooks. The frames follow the theme switch in the header.
          </p>
        </div>
        {/* Fifteen sections on one page: a link to each, in rows, or one row that scrolls on a phone. */}
        <nav aria-label="On this page" className="mt-8 max-sm:-mx-4">
          <ul className="flex gap-2 max-sm:[scrollbar-width:none] max-sm:overflow-x-auto max-sm:px-4 max-sm:py-1 sm:flex-wrap">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="tap-target border-line bg-raised/40 text-fg-soft hover:border-line-strong hover:text-fg-strong focus-visible:outline-cyan-soft relative inline-flex h-9 items-center rounded-lg border px-3 font-mono text-[12.5px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 sm:h-8"
                >
                  {section.short ?? section.heading.replace(/^<|\s*\/>$|\(.*\)$/g, '')}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <HighlightedFilesProvider files={files}>
          <div className="mt-12 flex flex-col gap-16 sm:mt-14">
            {SECTIONS.map((section) => (
              <Section key={section.id} {...section} />
            ))}
          </div>
        </HighlightedFilesProvider>
      </main>
      <Footer />
    </div>
  );
}
