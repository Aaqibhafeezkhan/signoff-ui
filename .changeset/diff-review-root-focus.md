---
'signoff-ui': patch
---

`DiffReview` keeps its keyboard after a click in Safari and every browser on iOS. They don't focus a button or a checkbox on click, so after Accept all, Reject all, Accept or Reject file, Viewed or Apply, focus was on the page: J, K and the review's other keys did nothing, and ⌘ or Ctrl + Enter went to the page, where an `ApprovalCard` with `globalShortcut` approved its tool call instead of the review being applied. The review's root is now focusable outside the tab order (`tabIndex={-1}`), so such a click, or a click on text in the review in any browser, leaves focus in the review. `useDiffReview`'s `getRootProps()` returns `tabIndex: -1` too, for the element you spread it on.
