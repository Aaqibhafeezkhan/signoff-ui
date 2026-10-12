'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DiffReview,
  JsonView,
  parseFileChange,
  reviewToolOutput,
  toPatch,
  type DiffReviewComment,
  type DiffReviewToolOutput,
  type FileChange,
  type HunkDecision,
} from 'signoff-ui';
import { CheckIcon, CopyIcon } from '@/components/icons';
import { RATELIMIT_UPSTASH, ROUTE_NEW, ROUTE_OLD } from '@/lib/scenario';

const GUIDE =
  '# Rate limiting\n\nEach user gets 10 requests every 10 seconds. Past that, the chat route answers 429.\n';

/** An agent's edit: a new file, a changed route, a moved guide and an image, with a comment already left. */
const FILES: FileChange[] = [
  { path: 'lib/ratelimit.ts', oldContent: '', newContent: RATELIMIT_UPSTASH },
  { path: 'app/api/chat/route.ts', oldContent: ROUTE_OLD, newContent: ROUTE_NEW },
  { path: 'docs/guides/rate-limiting.md', oldPath: 'docs/rate-limiting.md', oldContent: GUIDE, newContent: GUIDE },
  { path: 'public/errors/429.png', binary: true, oldContent: '', newContent: '' },
];

const COMMENTS: DiffReviewComment[] = [
  {
    id: 'c1',
    fileId: 'lib/ratelimit.ts',
    path: 'lib/ratelimit.ts',
    target: 'lines',
    hunkId: 'lib/ratelimit.ts:0',
    side: 'new',
    startLine: 7,
    endLine: 7,
    text: 'Read the window from an env var, so staging can use a longer one.',
  },
];

const DECISIONS: Record<string, HunkDecision> = {
  'lib/ratelimit.ts:0': 'accepted',
  'app/api/chat/route.ts:2': 'rejected',
};

/**
 * The site's own button, in the review's header through `actions`: the changes accepted so far, as
 * a patch `git apply` reads. It sits in a slot, so it keeps the site's styles and its keys.
 */
function CopyPatch({ decisions }: { decisions: Record<string, HunkDecision> }) {
  const parsed = useMemo(() => FILES.map((file) => parseFileChange(file)), []);
  const patch = toPatch(parsed, decisions);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const id = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(id);
  }, [state]);
  return (
    <>
      <button
        type="button"
        disabled={!patch}
        onClick={() => {
          navigator.clipboard.writeText(patch).then(
            () => setState('copied'),
            () => setState('failed'),
          );
        }}
        className="border-line focus-visible:outline-cyan-soft text-fg-muted hover:bg-line hover:text-fg inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === 'copied' ? <CheckIcon className="text-cyan-soft size-3.5" /> : <CopyIcon className="size-3.5" />}
        Copy as a patch
      </button>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Patch copied' : state === 'failed' ? 'Copying failed' : ''}
      </span>
    </>
  );
}

const rows = (count: number, name: (i: number) => string) =>
  Array.from({ length: count }, (_, i) => name(i)).join('\n') + '\n';

/**
 * What an agent regenerating code produces: a 5,000-line file rewritten top to bottom, which
 * diffs in a worker and goes over the edit limit, and a 3,000-line file with a few local edits.
 */
function largeFiles(): FileChange[] {
  const field = (i: number) => `  field_${i}: z.string().describe('Column ${i} of the export'),`;
  const routes = (i: number) => `router.get('/v1/items/${i}', handler(${i}));`;
  return [
    {
      path: 'src/generated/schema.ts',
      oldContent: rows(5_000, field),
      newContent: rows(5_000, (i) => `  field_${i}: z.string().min(1).describe('Column ${i} of the export'),`),
    },
    {
      path: 'src/server/routes.ts',
      oldContent: rows(3_000, routes),
      newContent: rows(3_000, (i) =>
        i % 400 === 7 ? `router.get('/v2/items/${i}', handler(${i}, { cache: true }));` : routes(i),
      ),
    },
  ];
}

const EXAMPLES = [
  ['review', 'A review with comments'],
  ['large', 'A 5,000-line rewrite'],
] as const;

export function DiffReviewDemo() {
  const [example, setExample] = useState<(typeof EXAMPLES)[number][0]>('review');
  const [output, setOutput] = useState<DiffReviewToolOutput>();
  const [decisions, setDecisions] = useState(DECISIONS);
  const large = useMemo(() => (example === 'large' ? largeFiles() : undefined), [example]);
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Example" className="border-line bg-raised/60 flex w-fit rounded-lg border p-0.5">
        {EXAMPLES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={example === id}
            onClick={() => {
              setExample(id);
              setOutput(undefined);
              setDecisions(DECISIONS);
            }}
            className="focus-visible:outline-cyan-soft text-fg-muted hover:text-fg aria-pressed:bg-line aria-pressed:text-fg cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1"
          >
            {label}
          </button>
        ))}
      </div>
      {large ? (
        <DiffReview key="large" files={large} title="Review a regenerated schema" onSubmit={() => {}} />
      ) : (
        <>
          <DiffReview
            key="review"
            files={FILES}
            decisions={decisions}
            onDecisionsChange={setDecisions}
            defaultComments={COMMENTS}
            actions={<CopyPatch decisions={decisions} />}
            // What the agent gets back: decisions, rejected hunks with their lines, and every comment.
            onSubmit={(result) => setOutput(reviewToolOutput(result, { contents: false }))}
          />
          {output && (
            <div className="flex flex-col gap-1.5">
              <p className="text-fg-muted text-xs">
                What the agent gets back, from <code className="font-mono">reviewToolOutput(result)</code> (contents
                left out here):
              </p>
              <JsonView value={output} label="Tool output" collapseAfter={40} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
