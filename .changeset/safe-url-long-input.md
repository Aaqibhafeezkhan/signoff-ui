---
'signoff-ui': patch
---

`safeUrl`, and so links and images in `Markdown`, `Sources` and file attachments in `AgentMessage`, no longer slow down on a URL from the agent that starts with a long run of spaces or control characters and has no colon: 100,000 of them took about 30 seconds and blocked the page, and now take under a millisecond. The scheme is still read past them, so ` javascript:alert(1)` still renders as text. `fromAcpDiffs` and `toAcpDiffs` no longer slow down on a `root` with a long run of slashes that are not at its end either.
