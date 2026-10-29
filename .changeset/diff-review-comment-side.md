---
'signoff-ui': patch
---

`DiffReview`: a comment on removed lines is named by their lines in the original. The selection already said "Line 21 of the original selected.", but the comment's field ("Comment on line 21, for the agent"), heading, Edit and Delete buttons and its announcement named line 21 of the proposed file, another line. They now say "line 21 of the original". `labels.diffReview.where` reads the comment's `side`, which it already received.
