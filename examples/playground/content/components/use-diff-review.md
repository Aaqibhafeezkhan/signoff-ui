`useDiffReview` is `DiffReview` without its markup: the same parsing, decisions, comments, viewed files, unchanged context, keyboard and result, for a review drawn with your own components. `DiffReview` is this hook and its styled markup, so the two behave the same.

### What to wire up

Spread `getRootProps()` on the element around the review: it holds the keyboard. Spread `getItemProps(i)` on each item's element: it brings a roving tabindex, the item's name and its decision. `items` lists everything to decide, in file order: each hunk, or a whole file when it has no hunks (binary, renamed or empty). The `index` the getters take is a position in that list. Render `announcement` in a polite live region: it says what each decision, selection, comment and viewed mark did.

### Decisions

`getDecisionProps(i, 'accepted')` and `getDecisionProps(i, 'rejected')` are the two buttons for an item, with `aria-pressed`; pressing one again resets the item. `getFileDecisionProps(fileId, decision)` decides a whole file, and `decideAll` the whole review. Pass `decisions` and `onDecisionsChange` to control them, or `defaultDecisions` to start from some. `counts` has how many are accepted, rejected and pending.

### Comments

`getLineNumberProps(i, line)` selects a line on click, and Shift-click extends the selection in the same hunk; the keys select lines as in `DiffReview`. `startComment()` opens a draft on the selected lines, or on the item. Render the draft in a labeled `textarea` with `getDraftProps()`: it brings focus, the text and its keys (⌘ or Ctrl + Enter saves, Escape cancels). `comments` and `onCommentsChange` control them.

### Files

`files` has each file's state: its id (the path, or `path#2` for a path that repeats), its items, its decision, how many of its items are decided, whether it is viewed or folded away, and the unchanged lines around its hunks (`gaps`), which `showContext` shows. `getViewedProps(fileId)` is a file's "Viewed" checkbox, and `getNavigatorItemProps(fileId)` a button in a list of files that is one tab stop.

### Applying

`getSubmitProps()` is the Apply button. It is `aria-disabled` while `comparing` is true, that is while a file is still diffed in a worker. `onSubmit(result, { toPatch })` receives the same result as `DiffReview`'s, once per state of the review, and `result()` and `toPatch()` read it at any time. `reviewToolOutput(result)` shapes it for the model.

### Your own controls

Keys pressed inside an element with `data-signoff-slot`, or in a portal rendered from it such as a menu, are left to that element, so J, K, A and R don't act from your buttons there.

### Large files

`maxEditLength` and `diffWorker` work as on `DiffReview`: past 2,000 lines added plus removed, a file's changed region is one hunk that replaces it, and a file that needs more than a few hundred edits is diffed in a worker. Its `parsed` is `undefined` until that is done.
