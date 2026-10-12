---
'signoff-ui': patch
---

`DiffReview` renders no actions slot for `actions={true}` or `actions=""`, as for `undefined`, `null` and `false`: React renders nothing for them, and the empty slot narrowed the title.
