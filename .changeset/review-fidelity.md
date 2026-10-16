---
'signoff-ui': patch
---

A review no longer tells the agent or the person something that did not happen.

- When the agent revises a file under the same `DiffReview` or `useDiffReview`, so that its contents change, that file's review starts over. Its decisions, viewed mark, fold, comments, selected lines and the comment being written on it are dropped, and the other files keep theirs. Before, a hunk's Accept stayed with its position: the revised file stayed folded at "0 pending", and Apply sent code nobody had seen. Controlled `decisions`, `viewed` and `comments` are read without that file's entries while they hold the same ones, kept in state or built on every render, and `onDecisionsChange`, `onViewedChange` and `onCommentsChange` get the values without them. Entries for the file that change in the same render as the new files are kept as meant for them.
- `reviewToolOutput`, and so `reviewResumeEntry`, lists each decided hunk by id in `decisions`, and the new `decisionsFromToolOutput(output)` reads them back. `ReviewToolUI` passes them to its read-only review, so a thread loaded again shows each hunk as it was decided rather than every one undecided. Viewed marks and comments are not shown again.
- A rename given only as a git patch (`rename from`, as `git diff` writes it) takes its `oldPath` from the patch. The review shows the old path, the result and the tool output carry it, and `toPatch` writes `rename from` the old path, which `git apply` reads. Before, it wrote the new path there, and `git apply` failed with "No such file or directory".
- A comment on selected lines that include removed lines next to lines of the proposed file keeps the removed ones: it records their range in the original as `oldStartLine` and `oldEndLine`, and its `excerpt` includes them. Before, a comment on " keep" and "-secret = load()" reached the agent as a comment on " keep" alone.
