import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReviewToolUI } from '../src/assistant-ui';
import { DiffReview, type DiffReviewResult } from '../src/diff-review';
import { parseFileChange, type FileChange } from '../src/lib/diff';
import { answerDiffRequest } from '../src/lib/diff-worker';

/*
 * Model-written input: a unified diff with the wrong hunk counts or a stray line, which jsdiff
 * refuses, a change with no path, or contents that are not strings. One such file must not fail
 * the render and take the files it can read down with it.
 */

const HEAD = '--- a/a.ts\n+++ b/a.ts\n';
const PATCHES = {
  // Three lines counted, two given.
  'hunk counts that do not match its lines': `${HEAD}@@ -1,3 +1,3 @@\n-a\n+b\n`,
  // One line counted too many on each side.
  'hunk counts one line off': `${HEAD}@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n`,
  'a line that is not +, - or space': `${HEAD}@@ -1,2 +1,2 @@\n a\n?weird\n-b\n+B\n`,
};
const noPath = { oldContent: 'a\n', newContent: 'b\n' } as unknown as FileChange;
const numberContent = { path: 'n.ts', oldContent: 'a\n', newContent: 42 } as unknown as FileChange;
const valid: FileChange = { path: 'ok.ts', oldContent: 'x\n', newContent: 'y\n' };

const items = () => screen.getAllByRole('group', { name: /^(Hunk|Change) /, hidden: true });

describe('parseFileChange, with malformed input', () => {
  it.each(Object.entries(PATCHES))('reads a patch with %s as a file decided as a whole', (_, patch) => {
    const file = parseFileChange({ path: 'a.ts', patch });
    expect(file).toMatchObject({ id: 'a.ts', path: 'a.ts', status: 'modified', hunks: [], binary: true });
    expect(file.oldContent).toBeUndefined();
    expect(file.newContent).toBeUndefined();
  });

  it('keeps a malformed patch whole even when the change says it is not binary', () => {
    expect(
      parseFileChange({ path: 'a.ts', patch: PATCHES['a line that is not +, - or space'], binary: false }),
    ).toMatchObject({ hunks: [], binary: true });
  });

  it('diffs a change with no path, as plain text', () => {
    const file = parseFileChange(noPath);
    expect(file).toMatchObject({ path: '', language: 'text', additions: 1, deletions: 1 });
    expect(file.binary).toBeUndefined();
  });

  it('reads contents or a patch that are not strings as a file decided as a whole, without them', () => {
    for (const change of [
      numberContent,
      { path: 'n.ts', oldContent: ['a'], newContent: 'b\n' },
      { path: 'n.ts', patch: { hunks: [] } },
    ] as unknown as FileChange[]) {
      const file = parseFileChange(change);
      expect(file).toMatchObject({ path: 'n.ts', hunks: [], binary: true });
      expect(file.oldContent).toBeUndefined();
      expect(file.newContent).toBeUndefined();
    }
  });

  it('diffs the contents when only an unused patch is malformed', () => {
    const file = parseFileChange({
      path: 'a.ts',
      oldContent: 'a\n',
      newContent: 'b\n',
      patch: 42,
    } as unknown as FileChange);
    expect(file).toMatchObject({ additions: 1, deletions: 1, newContent: 'b\n' });
    expect(file.binary).toBeUndefined();
  });

  it('reads `null` contents as missing, as before', () => {
    const file = parseFileChange({ path: 'a.ts', oldContent: null, newContent: 'a\n' } as unknown as FileChange);
    expect(file).toMatchObject({ additions: 1, deletions: 0 });
    expect(file.binary).toBeUndefined();
  });

  it('answers from the worker with the file, not an error', () => {
    const answer = answerDiffRequest({
      id: 1,
      change: { path: 'a.ts', patch: PATCHES['hunk counts one line off'] },
      options: {},
    });
    expect(answer).toMatchObject({ id: 1, parsed: { path: 'a.ts', binary: true } });
  });
});

describe('DiffReview, with malformed input', () => {
  it('shows a patch jsdiff cannot read as one change to decide, beside the files it can read', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(result: DiffReviewResult) => void>();
    render(
      <DiffReview
        files={[{ path: 'a.ts', patch: PATCHES['hunk counts that do not match its lines'] }, valid]}
        onSubmit={onSubmit}
      />,
    );
    expect(items()).toHaveLength(2);
    const [bad, good] = items();
    expect(bad).toHaveAccessibleName(/^Change 1 of 2, a\.ts/);
    expect(within(bad!).getByText('Binary file, not shown.')).toBeInTheDocument();
    expect(good).toHaveAccessibleName(/^Hunk 2 of 2, ok\.ts/);
    expect(within(good!).getByText('y')).toBeInTheDocument();

    await user.click(within(bad!).getByRole('button', { name: 'Reject change 1' }));
    await user.click(within(good!).getByRole('button', { name: 'Accept hunk 2' }));
    await user.click(screen.getByRole('button', { name: /^Apply/ }));
    const result = onSubmit.mock.calls[0]![0];
    expect(result.files.map((f) => [f.path, f.decision, f.content])).toEqual([
      ['a.ts', 'rejected', undefined],
      ['ok.ts', 'accepted', 'y\n'],
    ]);
    expect(result.files[0]!.rejected).toEqual(['a.ts:file']);
  });

  it.each(Object.entries(PATCHES))('renders a patch with %s', (_, patch) => {
    render(<DiffReview files={[{ path: 'a.ts', patch }, valid]} />);
    expect(items()).toHaveLength(2);
  });

  it('renders a change with no path', () => {
    render(<DiffReview files={[noPath, valid]} />);
    expect(items()).toHaveLength(2);
    expect(within(items()[0]!).getByText('b')).toBeInTheDocument();
  });

  it('renders contents that are not strings as one change to decide', () => {
    render(<DiffReview files={[numberContent, valid]} />);
    expect(items()).toHaveLength(2);
    expect(items()[0]).toHaveAccessibleName(/^Change 1 of 2, n\.ts/);
  });
});

describe('ReviewToolUI, with malformed arguments', () => {
  it('leaves out files without a path, and reviews the rest', () => {
    const files = [null, 'a.ts', noPath, valid, { path: 'a.ts', patch: PATCHES['a line that is not +, - or space'] }];
    const part = {
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'review_changes',
      args: { files },
      argsText: JSON.stringify({ files }),
      status: { type: 'requires-action', reason: 'tool-calls' },
      addResult: vi.fn(),
      resume: vi.fn(),
      respondToApproval: vi.fn(async () => {}),
    } as unknown as ToolCallMessagePartProps;
    render(<ReviewToolUI {...part} />);
    expect(items().map((item) => item.getAttribute('aria-label')?.split(',').slice(0, 2).join(','))).toEqual([
      'Hunk 1 of 2, ok.ts',
      'Change 2 of 2, a.ts',
    ]);
  });
});
