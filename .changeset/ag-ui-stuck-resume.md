---
'signoff-ui': patch
---

`useAgUiAgent`: a resumed run that starts and then ends without finishing, on a `RUN_ERROR`, a broken stream or `stop()`, no longer leaves the thread stuck with nothing to answer. `@ag-ui/client` keeps the interrupts pending until a run finishes (`RUN_FINISHED`) and turns down any run that doesn't answer them, but the hook had cleared them when the run started: the card read as answered, `respond` did nothing, and the next run was refused with "Thread has 1 pending interrupt(s) not addressed by resume". The interrupts are open again now. The card of a call whose tool hadn't run asks again, and answering it resumes the run. A call whose tool ran shows its result, still approved, and no card: answer its interrupt with `resolve`, as /docs/ag-ui shows. And the end of the run before a resume, which the client reports without waiting, no longer cancels the resume or takes back its answers when it comes late.
