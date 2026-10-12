'use client';

import {
  DiffReview,
  parseFileChange,
  type DiffReviewResult,
  type DiffReviewToolOutput,
  type FileChange,
  type FileDecision,
  type HunkDecision,
  type ToolPart,
} from 'signoff-ui';
import { useEffect, useRef } from 'react';
import type { Files } from '@/lib/project';
import type { ProposedFiles } from '@/lib/tools';
import { isReviewOutput, normalizePath } from '@/lib/workspace';
import { CheckIcon } from './icons';

/** A proposal as review files: each file as it was when the agent proposed it, and as proposed. */
export function toFileChanges(input: unknown, before: Files): FileChange[] {
  const files = (input as Partial<ProposedFiles> | undefined)?.files ?? [];
  return files
    .filter((file) => typeof file?.path === 'string' && typeof file.content === 'string')
    .map((file) => {
      const path = normalizePath(file.path);
      return { path, oldContent: before[path], newContent: file.content };
    });
}

/** Every hunk of these files accepted: for read-only reviews of what was applied. */
function allAccepted(files: readonly FileChange[]): Record<string, HunkDecision> {
  const decisions: Record<string, HunkDecision> = {};
  for (const file of files) for (const hunk of parseFileChange(file).hunks) decisions[hunk.id] = 'accepted';
  return decisions;
}

/** The `review_changes` call, in each of its states: arriving, waiting for your review, applied. */
export function ReviewTool({
  part,
  before,
  hint,
  onSubmit,
  shouldScroll,
}: {
  part: ToolPart;
  /** The project when the call was made. */
  before: Files;
  /** A line above the review, e.g. what the scripted agent does with comments. */
  hint?: string | undefined;
  onSubmit: (result: DiffReviewResult) => void;
  /** Whether to bring the review into view when it opens: the reader was following the run. */
  shouldScroll: () => boolean;
}) {
  switch (part.state) {
    case 'input-streaming':
      return (
        <div className="preparing" role="status">
          <span className="preparing-bar" aria-hidden="true" />
          Preparing changes…
        </div>
      );
    case 'input-available':
      return (
        <ReviewStep
          files={toFileChanges(part.input, before)}
          hint={hint}
          onSubmit={onSubmit}
          shouldScroll={shouldScroll}
        />
      );
    case 'output-available':
      return isReviewOutput(part.output) ? (
        <AppliedReview files={toFileChanges(part.input, before)} output={part.output} />
      ) : null;
    case 'output-error':
      return (
        <p className="error" role="alert">
          {part.errorText}
        </p>
      );
    default:
      return null;
  }
}

function ReviewStep({
  files,
  hint,
  onSubmit,
  shouldScroll,
}: {
  files: FileChange[];
  hint: string | undefined;
  onSubmit: (result: DiffReviewResult) => void;
  shouldScroll: () => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Start on the first hunk, so J, K, A and R work at once.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (shouldScroll()) ref.current?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    ref.current?.querySelector<HTMLElement>('[data-slot="signoff-diff-hunk"]')?.focus({ preventScroll: true });
    // On mount only: the review opens once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className="review">
      {hint && <p className="review-hint">{hint}</p>}
      <DiffReview files={files} onSubmit={onSubmit} title="Review the proposed changes" />
    </div>
  );
}

const DECISION: Record<FileDecision, string> = {
  accepted: 'Applied',
  partial: 'Partly applied',
  rejected: 'Left out',
  pending: 'Not decided',
  unchanged: 'Unchanged',
};

/** A submitted review: what the agent got back, and the diff of what was applied. */
function AppliedReview({ files, output }: { files: FileChange[]; output: DiffReviewToolOutput }) {
  const applied = files.flatMap((file): FileChange[] => {
    const content = output.files.find((f) => normalizePath(f.path) === file.path)?.content;
    return content === undefined || content === (file.oldContent ?? '') ? [] : [{ ...file, newContent: content }];
  });
  return (
    <div className="applied">
      <p className="applied-summary">
        <CheckIcon className="applied-icon" />
        {output.summary}
      </p>
      <ul className="applied-files" aria-label="Files">
        {output.files.map((file) => (
          <li key={file.path}>
            <span className="mono">{file.path}</span>
            <span className="badge" data-decision={file.decision}>
              {DECISION[file.decision]}
            </span>
          </li>
        ))}
      </ul>
      {output.comments.length > 0 && (
        <ul className="applied-comments" aria-label="Your comments">
          {output.comments.map((comment, i) => (
            <li key={i}>
              <span className="applied-comment">“{comment.text}”</span>
              <span className="mono muted">
                {comment.path}
                {comment.startLine !== undefined && `:${comment.startLine}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {applied.length > 0 && (
        <details className="applied-diff">
          <summary>Show what was applied</summary>
          <DiffReview files={applied} readOnly defaultDecisions={allAccepted(applied)} title="Applied changes" />
        </details>
      )}
    </div>
  );
}
