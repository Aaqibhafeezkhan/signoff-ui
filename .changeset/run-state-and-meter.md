---
'signoff-ui': patch
---

The status pill, the timeline and the meter report the run, not the person or the last run.

- `AgentMessage` and `ToolCallTimeline` take `pendingClientTools`, the names you give `deriveAgentState`: a call a person answers, such as `review_changes` answered with a `DiffReview`, shows no duration and is not announced as "finished in" one, since the time was the person's. Before, the row gave the time the person spent reviewing as the call's duration, which could be longer than the whole run's active time beside it. While it waits, the call reads "Needs approval", with no clock.
- `deriveAgentState` reads `thinking`, not `done`, in the render between a client-side tool's output landing (one in `pendingClientTools` or `clientTools`) and the request that continues the run, so the pill no longer shows "Done" for a moment when you apply a review. A run that ended with a sub-agent still running, its own calls settled, reads `stopped`, as the timeline shows that sub-agent, not `done`.
- A call that AI SDK 7's check denied after a person approved it (edited arguments that a `toolApproval` rule denies) reads "Blocked by policy." in the timeline and is announced as blocked by policy, not "Denied by user".
- `RunMeter`'s total never reads less than its time to first token: the live total ticks every 100 ms, so for a tick it could.

Getting started's walkthrough (and `examples/nextjs-minimal`) passes `pendingClientTools` to `AgentMessage`, takes the meter's usage only from the reply to your last message (a new run starts from "–", not from the last run's tokens and cost), and names the tool in the pill as the timeline does ("Review changes").

`ToolCallTimeline` grows by 0.1 kB gzipped (to 22.8 kB) and `AgentMessage` by 0.2 kB (to 91.7 kB).
