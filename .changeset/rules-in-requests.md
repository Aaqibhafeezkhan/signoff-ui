---
'signoff-ui': minor
---

To send a person's approval rules with each request, `policy.getRules()` returns the latest rules as plain data for the transport's `body`, and `parseApprovalRules(rules)` from `signoff-ui/core` checks them in the route before `toToolApproval`.
