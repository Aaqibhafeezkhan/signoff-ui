---
'signoff-ui': patch
---

A deny rule the server doesn't get no longer lets it approve a call the page denies. `toPlainRules`, and so `policy.getRules()`, leaves out the allow rules on the tools a deny rule with a `when` covers, and `parseApprovalRules` leaves out the allow rules that a deny rule it drops could overrule. The server asks about those calls, and the page answers them with every rule. `parseApprovalRules` also takes up to three `*` in a pattern by default, up from one, so a deny rule such as `git push*--force*` reaches the server.
