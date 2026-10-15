---
'signoff-ui': patch
---

`deriveAgentState` reads `thinking` while the model answers a call that has settled. After a person denied `run_command`, the status read "Working run_command" with a live timer until the model's first token, as if the denied command were running; it did the same after a call finished or failed. A call still running beside a settled one, such as a parallel call, still reads `working` with its name. `AgentMessage` and `ToolCallTimeline` take `failed`: pass `failed={status === 'error'}` with `active={false}`, and an approved call whose request failed (a server error, a dropped connection) reads "Stopped" instead of "Running" under the Error status.
