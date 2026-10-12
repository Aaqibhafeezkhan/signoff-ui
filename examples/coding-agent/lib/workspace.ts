import { getToolPartName, isToolPart, type AnyUIPart, type DiffReviewToolOutput } from 'signoff-ui/core';
import { PROJECT, type Files } from './project';

/*
 * The project as the run has left it: the original files, with each review's accepted hunks
 * applied in order. The state lives in the messages (each review's result holds the files as
 * applied), so the server rebuilds it on every request and keeps nothing between them.
 */

/** A path as the project keys it: "./src/a.ts" and "/src/a.ts" are "src/a.ts". */
export function normalizePath(path: string): string {
  return path.trim().replace(/^(?:\.\/|\/)+/, '');
}

/** Whether a tool output is a review result from `reviewToolOutput`. */
export function isReviewOutput(value: unknown): value is DiffReviewToolOutput {
  if (!value || typeof value !== 'object') return false;
  const { files } = value as { files?: unknown };
  return Array.isArray(files) && files.every((file) => !!file && typeof (file as { path?: unknown }).path === 'string');
}

/** The files once a review is applied. A new file whose only change was rejected is not created. */
export function applyReview(files: Files, review: DiffReviewToolOutput): Files {
  const next: Record<string, string> = { ...files };
  for (const file of review.files) {
    if (typeof file.content !== 'string') continue;
    const path = normalizePath(file.path);
    if (file.content === '' && next[path] === undefined) continue;
    next[path] = file.content;
  }
  return next;
}

/**
 * The project after every review in the messages, or, with `before`, as it was when that tool call
 * was made (the files a proposal is reviewed against).
 */
export function filesFromMessages(messages: readonly { parts: readonly AnyUIPart[] }[], before?: string): Files {
  let files = PROJECT;
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolPart(part)) continue;
      if (before !== undefined && part.toolCallId === before) return files;
      if (
        getToolPartName(part) === 'review_changes' &&
        part.state === 'output-available' &&
        isReviewOutput(part.output)
      )
        files = applyReview(files, part.output);
    }
  }
  return files;
}

export interface FileChangeSummary {
  path: string;
  status: 'added' | 'modified';
  oldContent: string | undefined;
  newContent: string;
}

/** What differs from the original project, file by file. */
export function changesFrom(files: Files, original: Files = PROJECT): FileChangeSummary[] {
  return Object.keys(files)
    .sort()
    .flatMap((path): FileChangeSummary[] => {
      const newContent = files[path]!;
      const oldContent = original[path];
      if (oldContent === newContent) return [];
      return [{ path, status: oldContent === undefined ? 'added' : 'modified', oldContent, newContent }];
    });
}
