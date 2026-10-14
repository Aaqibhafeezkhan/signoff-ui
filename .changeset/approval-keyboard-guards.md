---
'signoff-ui': patch
---

`ApprovalCard` and `ToolApprovalBatch` no longer send a decision the person did not make with the keyboard. A held key counts as one press: its repeats no longer confirm a critical action or answer a call again, whether the key is a shortcut (Y, S, A, N, Shift+N, ⌘/Ctrl+Enter) or Enter on a focused button, Approve all and Deny all included. `autoFocus` leaves focus in a text field the person is typing in, so the next letter they type is not taken as a shortcut, and `globalShortcut` leaves ⌘/Ctrl+Enter in a text field to that field, such as a chat composer's send.
