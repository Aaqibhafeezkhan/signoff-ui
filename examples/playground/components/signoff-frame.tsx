'use client';

import {
  ApprovalCard,
  computeReviewResult,
  decisionEffect,
  DiffReview,
  parseFileChange,
  reviewToolOutput,
  toToolApprovalResponse,
  type ApprovalChoice,
  type DiffReviewComment,
  type DiffReviewResult,
  type FileChange,
  type HunkDecision,
} from 'signoff-ui';
import { useRef, useState } from 'react';
import { tokenizeJson } from '@/lib/terminal';

/*
 * The home page's first screen: the social card (lib/og.tsx) made live. A two-file review over a
 * pending approval, real components in a still state: nothing plays and nothing takes focus. Click
 * or Tab in, and J, K, A and R work in the review, Y and N on the card. After each decision, a
 * panel prints what goes back to the agent, made by the kit's own helpers. The components and the
 * panel are two items of the page's grid (app/(home)/page.tsx): the panel sits under the headline.
 */

const RATELIMIT = `import { Ratelimit } from '@upstash/ratelimit';
import { redis } from '@/lib/redis';

const ratelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '10 s') });

/** Answers 429 past 10 requests in 10 seconds from one address, before the handler runs. */
export function withRateLimit(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const { success } = await ratelimit.limit(req.headers.get('x-forwarded-for') ?? 'anonymous');
    return success ? handler(req) : new Response('Too many requests', { status: 429 });
  };
}
`;

const ROUTE_OLD = `import { chat } from '@/lib/chat';
export const POST = chat;
`;

const ROUTE_NEW = `import { chat } from '@/lib/chat';
import { withRateLimit } from '@/lib/ratelimit';
export const POST = withRateLimit(chat);
`;

/** The agent's edit: the limiter it adds, and the route that calls it. */
const FRAME_FILES: FileChange[] = [
  { path: 'lib/ratelimit.ts', oldContent: '', newContent: RATELIMIT },
  { path: 'app/api/chat/route.ts', oldContent: ROUTE_OLD, newContent: ROUTE_NEW },
];
const PARSED = FRAME_FILES.map((file) => parseFileChange(file));

/** Where the review starts: the new file accepted and marked viewed (so folded), the route to decide. */
const START_DECISIONS: Record<string, HunkDecision> = { 'lib/ratelimit.ts:0': 'accepted' };
const START_VIEWED: Record<string, boolean> = { 'lib/ratelimit.ts': true };

const APPROVAL_ID = 'approval-1';
const COMMAND = { command: 'pnpm test', cwd: '~/acme/chat-app' };

/** What the agent receives, as the page would send it: the call that sends it, and its argument. */
interface Sent {
  tool: 'review_changes' | 'run_command';
  /** The decision in words, announced to screen readers. */
  summary: string;
  calls: Array<{ call: string; value: unknown }>;
}

function reviewSent(result: DiffReviewResult, applied: boolean): Sent {
  // File contents are left out here, as on the DiffReview docs page; the agent gets them too.
  const output = reviewToolOutput(result, { contents: false });
  return {
    tool: 'review_changes',
    summary: applied ? output.summary : `On Apply: ${output.summary}`,
    calls: [{ call: applied ? 'addToolOutput({ output })' : 'addToolOutput({ output }) on Apply', value: output }],
  };
}

function approvalSent(choice: ApprovalChoice): Sent {
  const response = toToolApprovalResponse(APPROVAL_ID, choice.decision, choice.reason);
  return {
    tool: 'run_command',
    summary: response.approved
      ? 'Approved: the command runs, and its output goes back to the agent.'
      : 'Denied: the agent gets the denial as the tool result, with your reason if you gave one.',
    calls: [
      { call: 'addToolApprovalResponse', value: response },
      // AI SDK 7 answers a denied call with this tool result, so the model reads the reason.
      ...(response.approved
        ? []
        : [{ call: 'the tool result the model reads', value: { type: 'execution-denied', reason: choice.reason } }]),
    ],
  };
}

/** JSON in the site's code colours (lib/terminal.ts). */
function Json({ value }: { value: unknown }) {
  return (
    <pre className="term font-mono text-[12px] leading-[1.6] break-words whitespace-pre-wrap">
      <code>
        {tokenizeJson(JSON.stringify(value, null, 2)).map((line, i) => (
          <span key={i} className="term-line">
            {line.map((token, j) =>
              token.kind ? (
                <span key={j} className={`json-${token.kind}`}>
                  {token.text}
                </span>
              ) : (
                token.text
              ),
            )}
          </span>
        ))}
      </code>
    </pre>
  );
}

export function SignoffFrame() {
  // A new key remounts the review and the card: Reset starts them over.
  const [round, setRound] = useState(0);
  const [choice, setChoice] = useState<ApprovalChoice>();
  const [applied, setApplied] = useState(false);
  const [sent, setSent] = useState<Sent>();
  // What else goes into the review's result, for the preview of what Apply sends.
  const viewed = useRef(START_VIEWED);
  const comments = useRef<DiffReviewComment[]>([]);

  const reset = () => {
    setRound((n) => n + 1);
    setChoice(undefined);
    setApplied(false);
    setSent(undefined);
    viewed.current = START_VIEWED;
    comments.current = [];
  };

  return (
    <>
      <section
        aria-labelledby="frame-heading"
        data-frame="signoff"
        className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-span-3 lg:row-start-1"
      >
        <h2 id="frame-heading" className="sr-only">
          Try a review and an approval
        </h2>
        <DiffReview
          key={`review-${round}`}
          files={FRAME_FILES}
          title="Review the agent’s edit"
          // The run below has a review too: each list of files is a landmark, so each needs its own name.
          labels={{ diffReview: { navigator: 'Files in the agent’s edit' } }}
          defaultDecisions={START_DECISIONS}
          defaultViewed={START_VIEWED}
          readOnly={applied}
          onViewedChange={(next) => {
            viewed.current = next;
          }}
          onCommentsChange={(next) => {
            comments.current = next;
          }}
          // Each decision shows what Apply would send; Apply sends it.
          onDecisionsChange={(decisions) =>
            setSent(
              reviewSent(
                computeReviewResult(PARSED, decisions, { viewed: viewed.current, comments: comments.current }),
                false,
              ),
            )
          }
          onSubmit={(result) => {
            setApplied(true);
            setSent(reviewSent(result, true));
          }}
        />
        <ApprovalCard
          key={`approval-${round}`}
          toolName="run_command"
          title="Run command"
          input={COMMAND}
          risk="medium"
          status={!choice ? 'pending' : decisionEffect(choice.decision).approved ? 'approved' : 'denied'}
          decision={choice?.decision}
          reason={choice?.reason}
          onDecide={(next) => {
            setChoice(next);
            setSent(approvalSent(next));
          }}
        />
      </section>
      <section
        aria-labelledby="frame-result-heading"
        className="border-line bg-code flex h-44 min-w-0 flex-col overflow-hidden rounded-xl border lg:col-start-1 lg:row-start-2"
      >
        <div className="border-line flex h-9 shrink-0 items-center gap-3 border-b px-3.5">
          <h3
            id="frame-result-heading"
            className="text-fg-subtle font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase"
          >
            What the agent receives
          </h3>
          {sent && <span className="text-cyan-soft truncate font-mono text-[11px]">{sent.tool}</span>}
          {sent && (
            <button
              type="button"
              onClick={reset}
              className="text-fg-muted hover:text-fg focus-visible:outline-cyan-soft ml-auto cursor-pointer rounded-sm text-xs underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Reset
            </button>
          )}
        </div>
        <p className="sr-only" aria-live="polite">
          {sent?.summary ?? ''}
        </p>
        {sent ? (
          // Scrolls on its own, so it is reachable from the keyboard (WCAG 2.1.1).
          <div
            className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-3.5 py-2.5"
            role="group"
            aria-label="What the agent receives"
            tabIndex={0}
          >
            {sent.calls.map(({ call, value }) => (
              <div key={call} className="mb-2 last:mb-0">
                <p className="text-fg-subtle mb-1 font-mono text-[11px]">{call}</p>
                <Json value={value} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-fg-subtle px-3.5 py-3 text-[13px] leading-relaxed text-pretty">
            Accept or reject the route’s hunk, apply the review, or answer the approval: what goes back to the agent
            prints here, as the page sends it.
          </p>
        )}
      </section>
    </>
  );
}
