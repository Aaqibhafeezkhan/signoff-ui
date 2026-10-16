---
'signoff-ui': patch
---

`ApprovalCard` and `ToolApprovalBatch` wait for the person on a critical action. The first press stays armed, with no time limit, until the second press, Escape, or focus leaving the card, instead of resetting after 4 seconds, so a screen reader user who confirms after hearing "Press approve again to confirm" no longer arms it again. An armed press belongs to its call: new arguments, or another call joining Approve all, need a new first press. The second click of a double click no longer counts as a press: a double click on Approve or Approve all arms a critical call and does not approve it. With `globalShortcut` on several pending cards, as `AgentMessage`'s `approvalProps` gives parallel calls, ⌘/Ctrl+Enter answers one card, the one the keys are pressed in or else the latest to ask, not the first card that mounted.
