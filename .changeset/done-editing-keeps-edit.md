---
'signoff-ui': patch
---

`ApprovalCard` keeps edited arguments when "Done editing" closes the editor. Before, an edit counted only while the editor was open, so editing a command, pressing "Done editing" and then Approve ran the original arguments. The card now shows the edited arguments in its preview, with the "Edited" note and "Undo edits", and keeps the editor open on "Done editing" while its JSON does not parse.
