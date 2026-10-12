---
'signoff-ui': patch
---

`ApprovalCard` (and `ToolApprovalCard`, and the cards in `AgentMessage` through `approvalProps`) no longer approves or denies when Y, S, A, N, Shift+N or ⌘/Ctrl+Enter is pressed on a control in a custom `preview`, or in a menu that `preview` opens in a portal. Those keys go to the control. With `globalShortcut`, ⌘/Ctrl+Enter still approves from anywhere on the page.
