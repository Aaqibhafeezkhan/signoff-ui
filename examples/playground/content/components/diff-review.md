Unified or split review of agent edits across files, with word-level highlights. Give it the old and new contents of each file, or a unified `patch` when you only have the diff, and it computes the hunks. The reviewer accepts or rejects each hunk or a whole file, comments on lines or hunks, marks files viewed and applies, and the agent gets back what it needs to act on.

### What the agent gets back

`onSubmit(result, { toPatch })` receives:

- `files`: each file's `decision` (`accepted`, `rejected`, `partial`, `pending` or `unchanged`), whether it was marked `viewed`, and its `content` with only the accepted hunks applied, unreviewed ones left out. Each file also carries the ids of the hunks accepted, rejected or left pending.
- `rejectedHunks`: each rejected hunk with its lines, so the agent knows what not to do again.
- `comments`: each with its file, its line range (`side`, `startLine`, `endLine`, and `oldStartLine` and `oldEndLine` for removed lines among lines of the proposed file), its text and the lines it is on (`excerpt`).
- `toPatch()`: the accepted changes as a git-style unified diff, which `git apply` reads.

`reviewToolOutput(result)` shapes that for the model. It gives a one-sentence summary, each file's decision with its applied contents, the rejected hunks, the comments and `decisions`, each decided hunk by id. A file the reviewer marked viewed has `viewed: true`, and the others have no `viewed` key, so the output stays small. Pass `{ contents: false, patch: toPatch() }` to send a patch instead of contents. It is plain JSON, so it is an AI SDK tool output as it is: `addToolOutput({ tool: 'review_changes', toolCallId, output: reviewToolOutput(result) })`. For an AG-UI agent paused on an interrupt, `reviewResumeEntry(interrupt.id, result)` is the resume entry, with the same payload: pass it to `useAgUiAgent`'s `resolve`.

To show a review again from its saved output, after a reload say, render it read-only with the same `files` and `decisions={decisionsFromToolOutput(output)}`: each hunk shows as it was decided. `ReviewToolUI` does this for assistant-ui. Only the decisions are shown again: the output's viewed marks and comments are there for the agent, and the review shown again has none. An output saved by an earlier version has no `decisions`, and shows every hunk undecided.

The review is sent once per state of the review. A double click or a repeated ⌘ or Ctrl + Enter sends one review, until a decision, a comment, a viewed mark or the files change. Files compare by content, so an inline `files` array does not count as a change. When `onSubmit` returns a promise, the review announces "Review sent" once it resolves and nothing if it rejects, so say what failed yourself; Apply works again once it settles.

Decisions are keyed by a hunk's position in its file, so when the agent revises a file under the same review, the review of that file starts over. Its decisions, viewed mark, fold and comments are dropped, with any lines selected or a comment being written on it, because they were about the old edit. Other files keep theirs. If you control `decisions`, `viewed` or `comments`, the review reads them without that file's entries and calls `onDecisionsChange`, `onViewedChange` and `onCommentsChange` once without them. It leaves them out for as long as you pass the same entries for that file, whether you keep the value in state, build it on every render (`decisions={{ ...decisions }}`) or copy it in the update that brings the new files. Entries for that file that change in the same render as the new files are taken as meant for the new edit, such as the decisions saved with another review, and are kept. To start the whole review over, give it a new `key`, such as the revision's id.

### Comments

Select lines from a hunk with Shift and the up or down arrow: down starts at its first changed line, up at its last. Or click a line number and Shift-click another. C comments on the selected lines, or on the whole hunk when none are selected, and the hunk's comment button does the same. ⌘ or Ctrl + Enter saves the comment and Escape cancels it. Lines are numbered in the proposed file, or in the original when only removed lines are selected (`side: 'old'`). Removed lines selected with lines of the proposed file are numbered in the original too (`oldStartLine`, `oldEndLine`), so they stay in the comment and in its `excerpt`. Control comments with `comments` and `onCommentsChange`, or start from `defaultComments`.

### Files

A review of several files lists them first. The list is one tab stop: the arrow keys move between files and Enter goes to one. Any file can be accepted or rejected whole, with its buttons or with Alt + A and Alt + R. A file can be marked viewed with its checkbox, or with V, which also moves to the next file. A viewed file folds away (`collapseViewed={false}` keeps it open), and `viewed` and `onViewedChange` control the marks. A renamed file shows its old path, from `oldPath` or from a git rename patch (`rename from`, which `git diff` writes by default). A binary file reads "Binary file, not shown": it is detected from a NUL character in its contents or from a binary patch, or set with `binary`. A file the review can't read shows the same way, so the other files stay reviewable: a patch whose hunk counts don't match its lines or with a line that doesn't start with +, - or a space, as models write them, or contents that aren't strings. Binary and unreadable files, renames without changes, and files created or deleted empty are each decided as a whole, under the id `` `${path}:file` ``. Put a review of a model's tool input inside an [error boundary](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary) all the same: `files` that is not an array of objects still fails the render.

### Context

Unchanged lines between hunks can be shown, 20 at a time or all at once, from the bar between hunks or with E around the focused hunk. That needs both contents: a patch alone has no lines outside its hunks.

### Large files

Large files stay responsive. A file that needs more than a few hundred edits is diffed in a worker and reads "Comparing changes…" until it is done; Apply waits for it. Webpack 5, Next.js and Vite emit the package's worker without configuration. `diffWorker` takes a function that starts your own worker, or `false` to diff on the main thread after the first paint. A file changed in more places than `maxEditLength` (2,000 lines added plus removed) is reviewed as one hunk that replaces the changed region, and the review says so. A long review renders only the rows near the screen, and so do unchanged lines shown between hunks, past their first 100. The rest keep their height and their text for screen readers, and every hunk stays in place for focus and for J and K: past the first 100, hunks render 100 at a time, and the one J or K moves to renders at once. A line over 2,000 characters shows as plain text, without syntax colors. [Performance and limits](/docs/limits) has the numbers.

### Your own buttons

`actions` puts your controls in the header, next to the layout toggle: `actions={<button onClick={copyPatch}>Copy as a patch</button>}`. They are your content, in a `data-signoff-slot` element, so `styles.css` leaves them to your CSS. Keys pressed on them, or in a menu they open, are theirs: J, K, A, R, ⌘ or Ctrl + Enter and the review's other shortcuts don't act from there. Pass nothing, `null` or `false` and the header stays as it was.

### Your own markup

[`useDiffReview`](/docs/components/use-diff-review) is all of this without the markup. It gives the files, decisions, comments, selection, viewed marks and shown context, and the keyboard. It also gives getters for items, buttons, the comment editor and a file navigator.

### On the server

`parseFileChange`, `applyHunks`, `computeReviewResult`, `toPatch`, `reviewToolOutput`, `decisionsFromToolOutput` and `reviewResumeEntry` are in `signoff-ui/core`, with no React. A server render diffs the files a render may diff, and shows the rest as being compared, so hydration matches. Long changed lines skip word-level highlights rather than stall.
