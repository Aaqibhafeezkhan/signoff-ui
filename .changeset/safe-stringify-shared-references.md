---
'signoff-ui': patch
---

An object that comes twice in a tool call's arguments or output, such as `{ build: { env }, test: { env } }`, no longer shows as `"[Circular]"` the second time. Every object already written counted as a cycle, so `ApprovalCard`'s arguments, its JSON editor and the timeline's JSON showed `"test": { "env": "[Circular]" }`, and approving an edit made in that editor sent the string `"[Circular]"` to the tool in place of the object. Only an object inside itself reads `[Circular]` now. Input parsed from JSON, as the AI SDK's is, has no shared objects; input your app builds, and client tool outputs, can.
