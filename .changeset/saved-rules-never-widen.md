---
'signoff-ui': patch
---

A rule with a `when` is no longer saved. JSON kept it without its `when`, so after a reload an allow rule covered every call its tool and `args` cover: a default that allowed reads in the repo allowed reading any file once anything was saved. `useApprovalPolicy` keeps such a rule for the page only, `webStorageRules` writes none, and a default with a `when` wins over a copy an earlier version saved without it. A rule with a `when` that an earlier version saved from `addRule` still loads without it; `removeRule(id)` clears it.

The pattern a lasting decision suggests for a command no longer covers more than a program and its subcommand. For a program alone it is the whole command, globs escaped: `rm -rf build`, not `rm*`, which allowed `rm -rf ~`. So it is for a command that runs what its arguments say, such as an interpreter, a shell, `npx`, `sudo`, `env`, `xargs` or `curl`: `node -e "…"`, not `node*`, and `npx prettier --write .`, not `npx prettier*`, which allowed `npx prettier-evil`. `npm test -- --watch` still suggests `npm test*`. A command with no program word, such as `$(…)`, suggests itself instead of any arguments.
