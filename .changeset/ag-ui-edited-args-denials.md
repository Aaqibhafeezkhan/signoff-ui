---
'signoff-ui': patch
---

`useAgUiAgent` and `answerAgUiInterrupt` send edited tool arguments as `editedArgs`, the field AG-UI 1.0 defines for approve-with-edits, so an agent that follows the spec runs the edited call rather than the original one. The payload still carries them as `input` too; that name is deprecated. A denied tool call now stays denied when the agent reports a result for it in the resumed run, as AG-UI agents do, instead of reading "Done".
