---
'signoff-ui': patch
---

An ACP approval card no longer picks one of several grants of the same kind for the person. `decisionsFromAcpOptions` offers an allow decision, or `deny-always`, only when the agent sent exactly one option of that kind, and `toAcpPermissionResponse` answers only with that option, cancelling the request when the agent sent several. Before, Always answered the agent's first `allow_always` option: on Claude Code's ExitPlanMode that is "Yes, clear context (26% used) and use auto mode", and on a Gemini CLI MCP tool "Allow all server tools for this session". Such a card now offers Approve and Deny, and Approve answers the agent's one `allow_once` option. Deny still answers the agent's first `reject_once` option when it sent several, since a denial grants nothing. When the agent sends one `allow_always` option, Always still answers it, and passing that option's `name` through `labels` makes the button say what it grants.
