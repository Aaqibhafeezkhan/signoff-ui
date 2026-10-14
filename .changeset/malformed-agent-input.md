---
'signoff-ui': patch
---

`DiffReview` and `parseFileChange` no longer throw on a file they can't read, which failed the render and took every other file in the review down with it. A patch jsdiff refuses (hunk counts that don't match its lines, or a line that doesn't start with +, - or a space), and contents or a patch that aren't strings, now give a file shown as a binary one is and decided as a whole. A change without a path no longer fails it either, and `ReviewToolUI` leaves files without a path out of the review.
