---
'signoff-ui': minor
---

`useAgUiAgent`: answers to interrupts hold up when things go wrong.

- Each interrupt takes one answer. A second answer before the resumed run started, from a retry, an app's own button or a second card for the same call, started a second `runAgent({ resume })`, even with the opposite decision. The first answer now stands, in `answerAgUiInterrupt` too.
- If the run that resumes ends before it starts (its request fails, the `runAgent` option rejects, or it is stopped), the answers are taken back and the cards ask again, with a failure in `error`. `respond` and `resolve` no longer reject when that run fails, as `useChat` doesn't, since the approval cards call them without catching.
- An interrupt past its `expiresAt` takes only a cancellation, as AG-UI requires. Denying it now sends `status: 'cancelled'`. Approving it sends nothing and sets `error` (code `interrupt_expired`); before, the card read Approved, the call kept reading Running, and the client's error went unhandled.
- `stop()` before the server answers reads as stopped, not as an error saying "This operation was aborted".
- `parsePartialJson`, which previews a tool call's arguments as they stream, no longer returns nothing for a chunk that ends in an escaped backslash and a `u`, as a Windows path does (`"C:\\Users`): it read that as a cut-off `\u` escape.

If your app caught the rejection of `respond` or `resolve` to show why a resume failed, read `error` instead (with `status === 'error'`): the promise now resolves either way. `answerAgUiInterrupt` now ignores a second answer to the same interrupt instead of replacing the first.

`useAgUiAgent` grows by 0.3 kB gzipped (to 3.9 kB).
