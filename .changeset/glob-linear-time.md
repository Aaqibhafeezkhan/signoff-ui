---
'signoff-ui': patch
---

Approval rules match an argument in time proportional to its length times the pattern's. `matchesGlob`, and with it `evaluateRules`, `toToolApproval` and `useApprovalPolicy`, used a regular expression that backtracked: a pattern with a few `*`, such as `*a*a*a*b`, took seconds on an argument of a few hundred characters that it didn't match, and held up the server or the page meanwhile. It now reads the value once and gives the same answers. `globToRegExp` still returns the same `RegExp`, which backtracks.
