---
'signoff-ui': patch
---

An ACP approval card no longer answers with an option the person never saw. `decisionsFromAcpOptions` offers a decision only when the agent sent one option of its kind, and `toAcpPermissionResponse` answers only with that option, cancelling the request when the agent sent several. Before, Always answered the agent's first `allow_always` option: on Claude Code's ExitPlanMode that is "Yes, clear context (26% used) and use auto mode", and on a Gemini CLI MCP tool "Allow all server tools for this session". Such a card now offers Approve and Deny, and Approve answers the agent's one `allow_once` option.
