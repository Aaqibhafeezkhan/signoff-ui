If your app already renders diffs with [@pierre/diffs](https://diffs.com), keep it, and add the review on top: accept or reject each hunk, comment on lines, and send the agent a result it can act on, with each file's accepted hunks applied, the rejected hunks and the comments. `useDiffReview` is that review without markup, so @pierre/diffs can render it. In the example above, @pierre/diffs draws two files an agent changed, and `useDiffReview` holds the decisions, the comments, the keyboard and the result. Its code is [one file](https://github.com/dgesteves/signoff-ui/blob/main/examples/playground/components/demos/pierre-review.tsx). Tested with `@pierre/diffs` 1.6.2 and React 19.

> [!NOTE]
> signoff-ui doesn't depend on @pierre/diffs: you install both, and this page connects them. How they differ is in [the comparison](/docs/comparison#diff-viewers).

## Install

```package-install
npm i signoff-ui @pierre/diffs
```

## The same hunks on both sides

Decisions and comments are keyed by the review's hunks, so @pierre/diffs has to draw those hunks and no others. Don't let it diff the two contents itself: another diff run can cut the hunks differently (another context size, another version of the diff library), and a decision would land on the wrong change. Give it the review's own diff instead. `toPatch` with every hunk accepted is that diff, and `processFile` reads it with both contents: hunk `i` there is hunk `i` of the review. The example shows a header above each hunk instead of the buttons that expand the unchanged lines between hunks, which have no accessible name (see [below](#what-stays-with-pierrediffs)), so those lines stay folded.

```tsx title="pierre-review.tsx"
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
```

`file` is one of the hook's `files`, and `file.parsed` its diff. A file with no hunks, such as a pure rename, an empty file or a binary one, has no lines to draw: @pierre/diffs gets its names, and `CHANGE` maps the review's `status` to its kind of change (`renamed` to `rename-pure`, `added` to `new`). A file too large to diff while rendering is diffed in a worker, and its `parsed` is `undefined` until then: show that it is being compared.

## Each hunk's controls in an annotation

A line annotation under each hunk's last changed line holds its controls. @pierre/diffs renders annotations in your page, not in its shadow root, so they take your styles and keep focus. Spread `getItemProps(i)` on the element in each one: J and K move between them, and A, R and C act on the one focused. `getDecisionProps(i, 'accepted')` and `getDecisionProps(i, 'rejected')` are its two buttons.

```tsx title="pierre-review.tsx"
function anchorOf(hunk: DiffHunk): { side: Side; lineNumber: number } {
  const last = hunk.lines.findLast((line) => line.type !== 'context')!;
  return last.type === 'add'
    ? { side: 'additions', lineNumber: last.newNumber! }
    : { side: 'deletions', lineNumber: last.oldNumber! };
}
```

```tsx title="pierre-review.tsx"
const annotations: DiffLineAnnotation<{ index: number }>[] = file.items.flatMap((item) =>
  item.hunk ? [{ ...anchorOf(item.hunk), metadata: { index: review.items.indexOf(item) } }] : [],
);
```

```tsx title="pierre-review.tsx"
<FileDiff
  fileDiff={fileDiff}
  options={options}
  lineAnnotations={annotations}
  selectedLines={selectedLines}
  renderAnnotation={(annotation) => <HunkControls review={review} index={annotation.metadata.index} />}
  className="border-line block overflow-hidden rounded-lg border"
  style={LINES[theme]}
/>
```

A file with no hunks is one item, decided as a whole: its `item.hunk` is `undefined`, and there is no changed line to put an annotation under. The example renders that item's controls above the file instead, with the comments and the comment being written whose `target` is `'file'`.

Spread `getRootProps()` on the element around the files, as on any `useDiffReview` markup: it holds the keyboard. Render `announcement` in a polite live region.

## Comments on lines

Turn on @pierre/diffs's line selection and make what it selects the review's selection, with `selectLines`. C, or a Comment button that calls `startComment`, then opens a comment on those lines. Pass the review's selection back as `selectedLines`, so lines selected from the keyboard (Shift and the arrows) are shown selected too.

```tsx title="pierre-review.tsx" collapse
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
```

A selection that runs across two hunks can't be commented on: the selection is cleared. Render the comment editor with the controls of the item it is on, with `getDraftProps()` on a labeled `textarea`.

## The result

`onSubmit` receives the same result as `DiffReview`'s: each file with only the accepted hunks applied, the rejected hunks and the comments. `reviewToolOutput(result)` makes it the tool output an agent reads, and `toPatch()` a patch `git apply` reads. Send it back as in [Inside your chat UI](/docs/chat-ui).

## What stays with @pierre/diffs

- **Drawing.** Highlighting, themes, split or unified, wrapping and virtualization are its options. The example follows the site's theme switch with `themeType`.
- **Accessibility of what it draws.** With its defaults, @pierre/diffs 1.6.2 fails axe (4.14) on two counts: its buttons that expand unchanged lines have no accessible name, and some tokens of its default themes fall below 4.5:1 contrast. Its selection color lowers contrast too: with the example's themes and line colors but the default selection, selected code fell to 4.03:1 in the dark theme, and a selected code comment to 3.67:1 in the light one. The example passes axe, also with lines selected and a comment being written, with GitHub's high-contrast themes, hunk headers instead of those buttons (`hunkSeparators: 'metadata'`), paler added and removed lines in the light theme, and a selection color of its own in each theme (`--diffs-bg-selection-override` and `--diffs-bg-selection-number-override`).
- **Its own accept and reject.** `diffAcceptRejectHunk` returns a new diff with a hunk's change resolved into the file. With `useDiffReview`, the review holds the decisions, and the diff stays as the agent proposed it, so every hunk keeps its index.

## Other renderers

The same split works with a renderer that draws a unified diff you give it: react-diff-view's `parseDiff` and diff2html read one, so `toPatch` with every hunk accepted is their input too. CodeMirror's merge view and Monaco's diff editor diff the two texts themselves, so their chunks can differ from the review's hunks. Only @pierre/diffs is tested here.
