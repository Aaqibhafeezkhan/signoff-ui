import Link from 'next/link';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import { highlight } from '@/lib/highlight';
import { CodeBlock } from './docs/code-block';
import { CallsToAction } from './hero';
import { ArrowRightIcon } from './icons';
import { getComparison } from '@/lib/comparison';
import { shadcnAdd } from '@/lib/site';

/*
 * The sections after the live run: what's in the kit (review and approval first), what it works
 * with, how it compares (the table in content/docs/comparison.md), and how to start. Server-rendered;
 * the only client code is the copy button.
 */

interface KitItem {
  name: string;
  id: string;
  description: ReactNode;
  /** One line at the card's foot; or `keys`, the shortcuts as key caps. */
  meta?: string;
  keys?: Array<{ keys: string[]; action: string }>;
  /** The sign-off pair: a wide card with a glimpse of the component. */
  preview?: 'diff' | 'approval';
}

// The sign-off pair first, wide, then the hooks behind them and the rest of the run: at four
// columns that is rows of 2, 4 and 4, and at two, rows of 2.
const KIT: KitItem[] = [
  {
    name: 'DiffReview',
    id: 'diff-review',
    description:
      'Accept or reject an agent’s edits hunk by hunk, across files, with your own controls in its header. Returns each file with only the accepted hunks applied.',
    keys: [
      { keys: ['J', 'K'], action: 'move' },
      { keys: ['A', 'R'], action: 'decide' },
    ],
    preview: 'diff',
  },
  {
    name: 'ApprovalCard',
    id: 'approval-card',
    description:
      'Approve or deny a tool call once, for the session or always: exactly what will run, how risky it is, and a reason the agent reads. Automatic decisions are shown as such.',
    keys: [
      { keys: ['Y'], action: 'approve' },
      { keys: ['N'], action: 'deny' },
    ],
    preview: 'approval',
  },
  {
    name: 'useDiffReview',
    id: 'use-diff-review',
    description: 'The same review without its markup: its state, keyboard and result, for your own design system.',
    meta: 'your markup, its keyboard',
  },
  {
    name: 'useApprovalPolicy',
    id: 'use-approval-policy',
    description: (
      <>
        Approval rules by tool and argument pattern, with an audit trail. <Code>getRules</Code> sends them with each
        request, and <Code>parseApprovalRules</Code> checks them in your route.
      </>
    ),
    meta: 'once, session or always',
  },
  {
    name: 'AgentMessage',
    id: 'agent-message',
    description:
      'A whole assistant message: reasoning, streaming markdown (or your own renderer), tool calls grouped into a timeline, approvals inline and sources.',
    meta: 'useChat parts, as they are',
  },
  {
    name: 'ToolCallTimeline',
    id: 'tool-call-timeline',
    description:
      'Every tool call with its state, duration and a waterfall, and sub-agents nested under the call that started them. Errors show inline; input and output on demand.',
    keys: [{ keys: ['↑', '↓'], action: 'between calls' }],
  },
  {
    name: 'RunMeter',
    id: 'run-meter',
    description: 'Tokens, estimated cost from your rates, time to first token and the prompt-cache hit rate.',
    meta: 'compact or expanded',
  },
  {
    name: 'AgentStatus',
    id: 'agent-status',
    description: 'The run’s state in one pill, with the tool that’s running and the time spent working.',
    meta: 'announced to screen readers',
  },
  {
    name: 'Sources',
    id: 'sources',
    description: 'Citations as chips or cards, with inline [n] markers in the answer that link to them.',
    meta: 'renders on the server too',
  },
  {
    name: 'useAgUiAgent',
    id: 'use-ag-ui-agent',
    description:
      'Runs any AG-UI agent and hands the same components its messages, status and usage. Interrupts become approvals.',
    meta: 'signoff-ui/ag-ui',
  },
];

// Part of the change the scripted run proposes (lib/scenario.ts), for the DiffReview card.
const PREVIEW_DIFF = [
  '+  const { success, reset } = await ratelimit.limit(ip);',
  '+  if (!success) {',
  "-  model: openai('gpt-4o'),",
  "+  model: openai('gpt-4.1-mini'),",
].join('\n');

/** A glimpse of a review: a few changed lines, highlighted at build time. Decoration; the card's text says it. */
async function DiffPreview() {
  // Shiki's HTML for the lines above; not focusable, since the card is already a link.
  const html = (await highlight(PREVIEW_DIFF, 'diff')).replace(' tabindex="0"', '');
  return (
    <div aria-hidden="true" className="code-block">
      <div className="code-title flex items-center justify-between gap-3">
        <span className="truncate">app/api/chat/route.ts</span>
        <span className="shrink-0">
          <span className="text-cyan-soft">+11</span> <span className="text-magenta-soft">−1</span>
        </span>
      </div>
      <div className="kit-preview-code" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/** A glimpse of an approval: what will run and how risky it is. Decoration; the card's text says it. */
function ApprovalPreview() {
  return (
    <div aria-hidden="true" className="code-block px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-magenta-soft font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase">
          Approval required
        </span>
        <span className="border-magenta/40 text-magenta-soft rounded-full border px-2 py-px text-[11px] font-medium">
          High risk
        </span>
      </div>
      <p className="text-fg-subtle mt-2.5 font-mono text-[11.5px]">~/acme/chat-app</p>
      <p className="mt-0.5 truncate font-mono text-[13px]">
        <span className="term-prompt">$ </span>
        <span className="term-command">pnpm add @upstash/ratelimit</span>
      </p>
    </div>
  );
}

/** Shortcuts as key caps, each with what it does. */
function KeyHints({ hints }: { hints: NonNullable<KitItem['keys']> }) {
  return (
    <span className="text-fg-subtle flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px]">
      {hints.map((hint) => (
        <span key={hint.action} className="inline-flex items-center gap-1">
          {hint.keys.map((key) => (
            <kbd
              key={key}
              className="border-line-strong bg-surface text-fg-soft inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-b-2 px-1 text-[10.5px]"
            >
              {key}
            </kbd>
          ))}
          <span className="ml-0.5">{hint.action}</span>
        </span>
      ))}
    </span>
  );
}

const WORKS_WITH: Array<{ title: string; body: ReactNode; code: string; language: string }> = [
  {
    title: 'AI SDK 6 & 7',
    body: (
      <>
        Hand it the last assistant message from <Code>useChat</Code>. Approvals from <Code>toolApproval</Code> show
        inline, and a review answers a tool with no <Code>execute</Code> through <Code>addToolOutput</Code>.
      </>
    ),
    code: '<AgentMessage\n  message={last}\n  onToolApproval={addToolApprovalResponse}\n  renderTool={review}\n/>',
    language: 'tsx',
  },
  {
    title: 'AG-UI',
    body: (
      <>
        LangGraph, CrewAI, Mastra, Pydantic AI and the rest of the protocol’s integrations, through one hook. Interrupts
        become approval cards, and sub-agents nest under the call that started them.
      </>
    ),
    code: "import { useAgUiAgent } from 'signoff-ui/ag-ui';",
    language: 'ts',
  },
  {
    title: 'Agent Client Protocol',
    body: (
      <>
        The protocol editors use to run coding agents. A prompt turn becomes a message, each permission request an
        approval card that maps the agent’s options to Approve, Always and Deny, and each edit a diff. Pure functions,
        nothing else to install.
      </>
    ),
    code: "import { reduceAcpTurn, toAcpMessage } from 'signoff-ui/acp';",
    language: 'ts',
  },
  {
    title: 'assistant-ui',
    body: (
      <>
        <Code>signoffTools</Code> puts a review on the tools that propose edits and the approval card on calls at an
        approval gate, answered through assistant-ui’s runtime.
      </>
    ),
    code: "import { signoffTools } from 'signoff-ui/assistant-ui';",
    language: 'ts',
  },
  {
    title: 'npm or shadcn',
    body: <>Install the package, or copy a component’s source into your app with the shadcn CLI and make it yours.</>,
    code: shadcnAdd('diff-review'),
    language: 'bash',
  },
  {
    title: 'Your chat UI',
    body: (
      <>
        Inside AI Elements or your own components. A Tailwind v4 entry, or a stylesheet for Tailwind v3 or none that
        styles only the components’ own elements.
      </>
    ),
    code: "import 'signoff-ui/styles.css';",
    language: 'ts',
  },
];

/** Inline code, in the style the docs use. */
function Code({ children }: { children: ReactNode }) {
  return <code className="inline-code">{children}</code>;
}

/** A comparison cell: inline Markdown from content/docs/comparison.md. */
function Cell({ children }: { children: string }) {
  return (
    <Markdown
      components={{ p: ({ children: text }) => <>{text}</>, code: ({ children: text }) => <Code>{text}</Code> }}
    >
      {children}
    </Markdown>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-fg-subtle font-mono text-[11px] font-medium tracking-[0.08em] uppercase">{eyebrow}</p>
      <h2
        id={id}
        className="text-fg-strong mt-3 text-[24px] leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]"
      >
        {title}
      </h2>
      {children && <p className="text-fg-muted mt-3 text-[15px] leading-relaxed text-pretty">{children}</p>}
    </div>
  );
}

function Section({ id, className = '', children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`mx-auto w-full max-w-[1320px] px-4 sm:px-6 ${className}`}>
      <div className="border-line/70 border-t py-14 sm:py-20">{children}</div>
    </section>
  );
}

export function Landing() {
  const comparison = getComparison();
  return (
    <>
      <Section id="kit-heading" className="mt-14 sm:mt-20">
        <SectionHeading id="kit-heading" eyebrow="Components" title="Review and approval, and the run around them">
          <Code>DiffReview</Code> and <Code>ApprovalCard</Code> are the sign-off: <Code>useDiffReview</Code> is the same
          review in your own markup, and <Code>useApprovalPolicy</Code> keeps the rules behind the approvals. The others
          render the rest of the run, or hand <Code>AgentMessage</Code> a whole assistant message and get them all, in
          order. Keyboard-first, announced to screen readers, and in both the npm package and the shadcn registry.
        </SectionHeading>
        <ul className="mt-8 grid gap-3 sm:mt-10 sm:grid-cols-2 lg:grid-cols-4">
          {KIT.map((item) => (
            // min-w-0: the preview's lines are cut, so they mustn't widen the column.
            <li key={item.id} className={`flex min-w-0 ${item.preview ? 'lg:col-span-2' : ''}`}>
              <a
                href={`/docs/components/${item.id}`}
                className="group border-line bg-raised/40 focus-visible:outline-cyan-soft hover:border-line-strong hover:bg-surface-2 relative flex w-full min-w-0 flex-col rounded-xl border p-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:p-5"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-fg font-mono text-[14px] font-semibold">{item.name}</span>
                  <ArrowRightIcon className="text-fg-faint group-hover:text-fg-muted size-4 transition-[color,translate] group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </span>
                <span className="text-fg-muted mt-2 text-[13.5px] leading-relaxed">{item.description}</span>
                {item.preview && (
                  <div className="mt-4">{item.preview === 'diff' ? <DiffPreview /> : <ApprovalPreview />}</div>
                )}
                <span className="mt-auto pt-3 sm:pt-4">
                  {item.keys ? (
                    <KeyHints hints={item.keys} />
                  ) : (
                    <span className="text-fg-subtle font-mono text-[11px]">{item.meta}</span>
                  )}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="works-heading">
        <SectionHeading id="works-heading" eyebrow="Works with" title="Fits the stack and the chat you already have">
          It renders what your agent already streams, so there’s no runtime or state model to adopt, and it calls no
          model itself: bring OpenAI, Anthropic, Google, xAI, Mistral or a local model, with your own keys. Typed
          against AI SDK 6 and 7, tested on React 18 and 19 in CI, and prerenders under Next.js 16 with{' '}
          <Code>cacheComponents</Code>.
        </SectionHeading>
        <ul className="border-line mt-8 grid grid-cols-1 overflow-hidden rounded-xl border sm:mt-10 md:grid-cols-2">
          {WORKS_WITH.map((item) => (
            <li
              key={item.title}
              className="border-line flex flex-col gap-3 border-b p-5 last:border-b-0 sm:p-6 md:odd:border-r md:[&:nth-last-child(2)]:border-b-0"
            >
              <h3 className="text-fg text-[15px] font-semibold">{item.title}</h3>
              <p className="text-fg-muted text-[13.5px] leading-relaxed">{item.body}</p>
              <div className="mt-auto">
                <CodeBlock code={item.code} language={item.language} />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="compare-heading">
        <SectionHeading id="compare-heading" eyebrow="Comparison" title="How it compares">
          assistant-ui and AI Elements cover the whole chat, and you may well want one of them for it. assistant-ui’s
          Elements collection (since August 2026) is the closest to this kit, and far wider: an approval card, a
          reviewable diff, a trace waterfall, a tool timeline, a cost meter, agent status and more. Here’s where
          signoff-ui differs on the parts they share.
        </SectionHeading>
        <div className="border-line mt-8 overflow-hidden rounded-xl border sm:mt-10">
          <div
            className="border-line bg-surface text-fg-muted hidden grid-cols-[10rem_1fr_1fr] border-b font-mono text-[12px] md:grid"
            aria-hidden="true"
          >
            <span className="px-5 py-3" />
            <span className="text-cyan-soft border-line border-l px-5 py-3">{comparison.columns.kit}</span>
            <span className="border-line border-l px-5 py-3">{comparison.columns.other}</span>
          </div>
          <dl>
            {comparison.rows.map((row) => (
              <div key={row.topic} className="border-line grid border-b last:border-b-0 md:grid-cols-[10rem_1fr_1fr]">
                <dt className="text-fg px-5 pt-4 text-[13px] font-medium md:py-4">{row.topic}</dt>
                <dd className="border-line text-fg-soft px-5 pt-2 pb-2 text-[13.5px] leading-relaxed md:border-l md:py-4">
                  <span className="text-cyan-soft mb-0.5 block font-mono text-[11px] md:sr-only">
                    {comparison.columns.kit}:{' '}
                  </span>
                  <Cell>{row.kit}</Cell>
                </dd>
                <dd className="border-line text-fg-muted px-5 pt-2 pb-4 text-[13.5px] leading-relaxed md:border-l md:py-4">
                  <span className="text-fg-subtle mb-0.5 block font-mono text-[11px] md:sr-only">
                    {comparison.columns.other}:{' '}
                  </span>
                  <Cell>{row.other}</Cell>
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="text-fg-muted mt-8 grid gap-6 text-[14px] leading-relaxed md:grid-cols-2">
          <p>
            <span className="text-fg font-medium">AI Elements</span> is Vercel’s shadcn registry for AI SDK apps, with
            the widest coverage of the message surface: conversation, prompt input, reasoning, sources, a per-call{' '}
            <Code>Tool</Code> card, a <Code>Confirmation</Code> for approvals, a <Code>Context</Code> usage indicator
            and more. It targets React 19 and Tailwind v4, and is written against AI SDK 6.
          </p>
          <p>
            <span className="text-fg font-medium">They compose.</span> Render the thread with either library and use
            these components for the review and the approvals.{' '}
            <Link
              href="/docs/comparison"
              className="text-cyan-soft focus-visible:outline-cyan-soft decoration-cyan/40 hover:decoration-cyan rounded-sm underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              The full comparison
            </Link>{' '}
            also lists what they do better, such as assistant-ui’s chat runtime and its much wider set of components.
          </p>
        </div>
      </Section>

      <section aria-labelledby="start-heading" className="mx-auto w-full max-w-[1320px] px-4 pb-16 sm:px-6 sm:pb-24">
        <div className="border-line bg-surface relative overflow-hidden rounded-2xl border px-5 py-10 sm:px-10 sm:py-14">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_260px_at_15%_0%,var(--site-glow-cyan),transparent_70%)]"
            aria-hidden="true"
          />
          <div className="relative">
            <SectionHeading id="start-heading" eyebrow="Get started" title="Start with the sign-off">
              Put a <Code>DiffReview</Code> on the tool that proposes edits and a <Code>ToolApprovalCard</Code> on the
              ones that need a person, and add the rest when you want them. Install from npm, or copy the source in with
              the shadcn CLI. MIT licensed.
            </SectionHeading>
            <div className="mt-8">
              <CallsToAction />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
