---
'signoff-ui': patch
---

`DiffReview` shows a rejected hunk's lines in muted text, without syntax colors or word highlights and with its added lines still struck through, instead of fading the rows to 55% opacity, which took their text under 4.5:1 contrast.
