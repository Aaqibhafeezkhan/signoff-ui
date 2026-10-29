---
'signoff-ui': patch
---

`useAgUiAgent`: a resumed run that starts and then ends without finishing, on a `RUN_ERROR`, a broken stream or `stop()`, no longer leaves the thread stuck. `@ag-ui/client` keeps the interrupts pending until a run finishes (`RUN_FINISHED`) and turns down any run that doesn't answer them, but the hook had cleared them when the run started: the card read as answered, `respond` did nothing, and the next run was refused with "Thread has 1 pending interrupt(s) not addressed by resume". The cards now ask again, and answering them resumes the run.
