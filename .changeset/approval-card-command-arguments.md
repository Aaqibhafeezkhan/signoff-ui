---
'signoff-ui': patch
---

`ApprovalCard` shows the arguments that come with a command. A call such as `{ command: 'rm -rf build', dangerouslyDisableSandbox: true }` showed only `$ rm -rf build`, and a focused card said only "Runs rm -rf build.", so a person approved without seeing the rest of what the call runs with. Every argument other than `command` and a text `cwd` now shows as JSON below the command line, and the card's description adds the first of them ("Runs rm -rf build. With dangerouslyDisableSandbox true."). A translation's `approvalCard.summary` now gets `args` with a `command` too.
