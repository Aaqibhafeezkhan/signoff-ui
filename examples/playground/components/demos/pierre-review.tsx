'use client';

import {
  parseDiffFromFile,
  processFile,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type SelectedLineRange,
} from '@pierre/diffs';
import { FileDiff, useStableCallback } from '@pierre/diffs/react';
import { useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import {
  JsonView,
  reviewToolOutput,
  toPatch,
  useDiffReview,
  type DiffHunk,
  type DiffReviewDraft,
  type DiffReviewFileState,
  type DiffReviewToolOutput,
  type FileChange,
  type ParsedFileDiff,
  type UseDiffReviewResult,
} from 'signoff-ui';
import type { ReviewItem } from 'signoff-ui/core';
import { RATELIMIT_UPSTASH, ROUTE_NEW, ROUTE_OLD } from '@/lib/scenario';

const FILES: FileChange[] = [
  { path: 'lib/ratelimit.ts', oldContent: '', newContent: RATELIMIT_UPSTASH },
  { path: 'app/api/chat/route.ts', oldContent: ROUTE_OLD, newContent: ROUTE_NEW },
];

type Side = 'additions' | 'deletions';

/** @pierre/diffs's kind of change, for a file it draws without hunks. */
const CHANGE = { added: 'new', deleted: 'deleted', renamed: 'rename-pure', modified: 'change' } as const;

/**
 * The file as @pierre/diffs reads it, with the review's own hunks: the patch of every hunk accepted
 * is the diff itself, read with both contents. Hunk `i` here is hunk `i` of the review. A file with
 * no hunks (a pure rename, an empty or a binary file) is drawn as its name and kind of change.
 */
function toPierre(file: ParsedFileDiff): FileDiffMetadata {
  const oldFile = { name: file.oldPath ?? file.path, contents: file.oldContent ?? '' };
  const newFile = { name: file.path, contents: file.newContent ?? '' };
  if (file.hunks.length === 0) {
    const names = parseDiffFromFile({ ...oldFile, contents: '' }, { ...newFile, contents: '' });
    return { ...names, type: CHANGE[file.status] };
  }
  const all = Object.fromEntries(file.hunks.map((hunk) => [hunk.id, 'accepted' as const]));
  return processFile(toPatch([file], all), { oldFile, newFile, throwOnError: true })!;
}

/** Where a hunk's controls go: under its last changed line. */
function anchorOf(hunk: DiffHunk): { side: Side; lineNumber: number } {
  const last = hunk.lines.findLast((line) => line.type !== 'context')!;
  return last.type === 'add'
    ? { side: 'additions', lineNumber: last.newNumber! }
    : { side: 'deletions', lineNumber: last.oldNumber! };
}

/** A line's index in `hunk.lines`, by its number on one side: -1 when the hunk doesn't show it. */
function indexOf(hunk: DiffHunk, side: Side, lineNumber: number) {
  return hunk.lines.findIndex((line) =>
    side === 'deletions'
      ? line.type !== 'add' && line.oldNumber === lineNumber
      : line.type !== 'del' && line.newNumber === lineNumber,
  );
}

/** A line of a hunk as @pierre/diffs selects it: a removed line on the old side, the others on the new. */
function pointOf(hunk: DiffHunk, index: number): { side: Side; lineNumber: number } {
  const line = hunk.lines[index]!;
  return line.type === 'del'
    ? { side: 'deletions', lineNumber: line.oldNumber! }
    : { side: 'additions', lineNumber: line.newNumber! };
}

/** Follows the site's theme switch, which puts `.dark` or `.light` on <html>. */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
const themeOf = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

/**
 * Accessible choices over @pierre/diffs's defaults, checked with axe: GitHub's high-contrast themes,
 * hunk headers rather than expand buttons with no name, in the light theme paler added and removed
 * lines, so comments keep 4.5:1, and a blue selection, paler in the light theme and darker in the
 * dark one, so code on selected lines keeps it too.
 */
const THEMES = { dark: 'github-dark-high-contrast', light: 'github-light-high-contrast' };
const LINES = {
  light: {
    '--diffs-bg-addition-override': '#eff7ef',
    '--diffs-bg-deletion-override': '#fef1f1',
    '--diffs-bg-selection-override': '#b6e3ff',
    '--diffs-bg-selection-number-override': '#b6e3ff',
  } as CSSProperties,
  dark: {
    '--diffs-bg-selection-override': '#0d419d',
    '--diffs-bg-selection-number-override': '#0d419d',
  } as CSSProperties,
};

const LABEL = { pending: 'Not decided', accepted: 'Accepted', rejected: 'Rejected' } as const;

/** The id of a hunk's controls, to focus them after lines are selected with the mouse. */
const controlsId = (itemId: string) => `pierre-review-${itemId}`;

const button =
  'border-line text-fg-soft hover:text-fg aria-pressed:bg-raised aria-pressed:text-fg focus-visible:outline-cyan-soft cursor-pointer rounded-md border px-2 py-0.5 text-xs focus-visible:outline-2';

/** Whether a comment, or the one being written, is on an item: on its hunk, or on a file with none. */
const isOn = (item: ReviewItem, on: Pick<DiffReviewDraft, 'fileId' | 'target' | 'hunkId'>) =>
  item.hunk ? on.hunkId === item.id : on.target === 'file' && on.fileId === item.file.id;

/** What the comment editor says it is on: `line 31`, `lines 15–16`, `old line 4`, the change or the file. */
function draftLabel(draft: DiffReviewDraft) {
  if (draft.target === 'file') return 'Comment on this file';
  if (draft.target !== 'lines' || !draft.range) return 'Comment on this change';
  const { side, startLine, endLine } = draft.range;
  const lines = startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;
  return `Comment on ${side === 'old' ? 'old ' : ''}${lines}`;
}

/**
 * One item's controls: its decision, its comments and the comment editor. A hunk's are in the
 * annotation under it, and a file with no hunks has its own above the file.
 */
function HunkControls({ review, index }: { review: UseDiffReviewResult; index: number }) {
  const item = review.items[index]!;
  const decision = review.decisions[item.id] ?? 'pending';
  const comments = review.comments.filter((comment) => isOn(item, comment));
  const draft = review.draft && isOn(item, review.draft) ? review.draft : undefined;
  return (
    <div
      {...review.getItemProps(index)}
      id={controlsId(item.id)}
      className="border-line bg-surface focus-visible:outline-cyan-soft data-[decision=accepted]:border-cyan/50 data-[decision=rejected]:border-magenta/50 m-2 flex flex-col gap-2 rounded-lg border p-2 font-sans focus-visible:outline-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg-muted text-xs">{LABEL[decision]}</span>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => review.startComment({ itemId: item.id })} className={button}>
            Comment
          </button>
          <button {...review.getDecisionProps(index, 'rejected')} className={button}>
            Reject
          </button>
          <button {...review.getDecisionProps(index, 'accepted')} className={button}>
            Accept
          </button>
        </span>
      </div>
      {comments.map((comment) => (
        <p key={comment.id} className="text-fg-soft text-xs">
          {comment.startLine !== undefined && (
            <span className="text-fg-muted">
              {comment.side === 'old' ? 'Old line' : 'Line'}
              {comment.endLine === comment.startLine
                ? ` ${comment.startLine}`
                : `s ${comment.startLine}–${comment.endLine}`}
              :{' '}
            </span>
          )}
          {comment.text}
        </p>
      ))}
      {draft && (
        <div className="flex flex-col gap-1.5">
          <label className="text-fg-muted flex flex-col gap-1 text-xs">
            {draftLabel(draft)}
            <textarea
              {...review.getDraftProps()}
              rows={2}
              className="border-line bg-ink text-fg focus-visible:outline-cyan-soft rounded-md border px-2 py-1.5 text-[13px] focus-visible:outline-2 pointer-coarse:text-base"
            />
          </label>
          <span className="flex justify-end gap-2">
            <button type="button" onClick={review.cancelDraft} className={button}>
              Cancel
            </button>
            <button type="button" onClick={review.saveDraft} className={button}>
              Save
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/** One file, drawn by @pierre/diffs, with the review's controls under each hunk, or above a file with none. */
function PierreFile({
  review,
  file,
  theme,
}: {
  review: UseDiffReviewResult;
  file: DiffReviewFileState;
  theme: 'light' | 'dark';
}) {
  const parsed = file.parsed;
  const fileDiff = useMemo(() => parsed && toPierre(parsed), [parsed]);
  // A review item's index, by its hunk: what the controls and the selection work with.
  const annotations: DiffLineAnnotation<{ index: number }>[] = file.items.flatMap((item) =>
    item.hunk ? [{ ...anchorOf(item.hunk), metadata: { index: review.items.indexOf(item) } }] : [],
  );
  // Lines selected in @pierre/diffs become the review's selection, which a comment is on.
  const onLineSelected = useStableCallback((range: SelectedLineRange | null) => {
    if (!range) return review.clearSelection();
    const start = { side: range.side ?? 'additions', lineNumber: range.start };
    const end = { side: range.endSide ?? start.side, lineNumber: range.end };
    for (const item of file.items) {
      if (!item.hunk) continue;
      const from = indexOf(item.hunk, start.side, start.lineNumber);
      const to = indexOf(item.hunk, end.side, end.lineNumber);
      if (from === -1 || to === -1) continue;
      review.selectLines(item.id, Math.min(from, to), Math.max(from, to));
      // The hunk's controls take focus, without scrolling to them, so C, A and R act on it.
      review.activate(review.items.indexOf(item));
      document.getElementById(controlsId(item.id))?.focus({ preventScroll: true });
      return;
    }
    review.clearSelection();
  });
  // And the review's selection, from the keyboard too (Shift and the arrows), is shown there.
  const selection = review.selection?.item.file.id === file.id ? review.selection : undefined;
  const first = selection && pointOf(selection.hunk, selection.from);
  const last = selection && pointOf(selection.hunk, selection.to);
  const selectedLines =
    first && last ? { start: first.lineNumber, side: first.side, end: last.lineNumber, endSide: last.side } : null;
  const options = useMemo(
    () => ({
      themeType: theme,
      theme: THEMES,
      hunkSeparators: 'metadata' as const,
      diffStyle: 'unified' as const,
      overflow: 'wrap' as const,
      enableLineSelection: true,
      onLineSelected,
    }),
    [theme, onLineSelected],
  );
  // A file with no hunks (a pure rename, an empty or a binary file) is decided as a whole.
  const whole = file.items.find((item) => !item.hunk);
  // A large file is diffed in a worker: `parsed` is undefined until then.
  if (!fileDiff) return <p className="text-fg-muted text-xs">Comparing {file.path}…</p>;
  return (
    <div>
      {whole && <HunkControls review={review} index={review.items.indexOf(whole)} />}
      <FileDiff
        fileDiff={fileDiff}
        options={options}
        lineAnnotations={annotations}
        selectedLines={selectedLines}
        renderAnnotation={(annotation) => <HunkControls review={review} index={annotation.metadata.index} />}
        className="border-line block overflow-hidden rounded-lg border"
        style={LINES[theme]}
      />
    </div>
  );
}

/**
 * useDiffReview holds the review, and @pierre/diffs draws it: the hook's hunks become the diff it
 * renders, and each hunk's controls go in an annotation under it. The result is the review's own.
 */
export function PierreReviewDemo() {
  const [output, setOutput] = useState<DiffReviewToolOutput>();
  const theme = useSyncExternalStore(subscribeTheme, themeOf, () => 'dark' as const);
  const review = useDiffReview({
    files: FILES,
    onSubmit: (result) => setOutput(reviewToolOutput(result, { contents: false })),
  });
  return (
    <section
      aria-label="Review drawn by @pierre/diffs"
      {...review.getRootProps()}
      className="flex flex-col gap-3 font-sans"
    >
      {review.files.map((file) => (
        <PierreFile key={file.id} review={review} file={file} theme={theme} />
      ))}
      <div className="flex items-center gap-3">
        <p className="text-fg-subtle text-xs">
          J and K move, A and R decide, C comments on the selected lines. {review.counts.pending} of{' '}
          {review.counts.total} not decided.
        </p>
        <button
          {...review.getSubmitProps()}
          className="bg-cyan text-ink focus-visible:outline-cyan-soft ml-auto cursor-pointer rounded-md px-3 py-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Send
        </button>
      </div>
      {output && (
        <div className="flex flex-col gap-1.5">
          <p className="text-fg-muted text-xs">
            What the agent gets back, from <code className="font-mono">reviewToolOutput(result)</code> (contents left
            out here):
          </p>
          <JsonView value={output} label="Tool output" collapseAfter={40} />
        </div>
      )}
      <p role="status" className="sr-only">
        {review.announcement}
      </p>
    </section>
  );
}
