---
'signoff-ui': minor
---

Security fix: a deny rule now holds when a command is written another way. Its pattern also matches each command of a shell line on its own, read from its first word past `NAME=value` settings and a path, and past words such as `env`, `sudo` or `sh -c`. So a server rule denying `git push*` now denies `git status && git push`, `/usr/bin/git push`, `GIT_TRACE=1 git push`, `env git push` and `bash -c "git push"`, which a person's rule allowing every command used to approve. The line is split inside quotes too, so a deny rule can also deny a command that only mentions another, such as `git commit -m "wip; git push"`. Allow rules still match from the first character.

Deny rules fail closed: one covers an array argument when an item, or the items joined by spaces, match, and covers an object it can't read and a call whose `when` throws. A dotted argument name reads a key of that name as well as the nested argument: an allow rule needs both to match, a deny rule either. In a tool pattern, `*` and `?` match any character, so `*` covers every tool, as documented.

Matching a call against all its rules now stops after a fixed amount of work, a few tens of milliseconds and a little more for each character of the arguments they read, and what it hasn't finished counts against the call: an allow rule allows nothing, a deny rule denies. 100 long rules sent by a client no longer hold up a route for seconds.

`useApprovalPolicy` no longer erases the saved rules when a person decides before an async storage loads: the change goes over the rules it loads, and is saved with them. `answer()` gives a cached outcome only for the call it answered, so another call that comes with the same id is decided from the rules again. `webStorageRules` leaves out a stored rule with `args: null` instead of throwing on load.
