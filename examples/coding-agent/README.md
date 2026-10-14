# Coding agent

The signoff-ui reference app: a coding agent working in the background on a small repository. It asks before it runs commands, your approval rules answer the calls they cover, and nothing it writes lands until you apply it in a review. Your comments go back to the agent, and it revises.

Start an app of your own from it:

```bash
npx create-next-app@latest my-agent --example https://github.com/dgesteves/signoff-ui/tree/main/examples/coding-agent
cd my-agent
npm run dev   # http://localhost:3400
```

Or run it from a clone of this repository, against the library's source:

```bash
git clone https://github.com/dgesteves/signoff-ui.git
cd signoff-ui
pnpm install
pnpm build:lib
pnpm --filter coding-agent dev   # http://localhost:3400
```

It needs no API key: a scripted agent plays the run, the same way every time. To offer a real model too, copy `.env.example` to `.env.local` and set `OPENAI_API_KEY` and `LIVE_MODE=1` (and `OPENAI_MODEL` for a model other than `gpt-5.4-mini`); the key alone turns nothing on. The scripted agent stays the default: the page offers the model as a second choice, with the same tools, rules and reviews, and a run uses the key only when someone picks it. The route has no rate limit or budget, and each request runs up to 20 steps: with `LIVE_MODE=1` on a public deployment, anyone who can reach it runs the model on your key.

## The run

The task: `slugify('Crème brûlée')` returns `cr-me-br-l-e`, and should return `creme-brulee`.

1. The agent lists and reads files. Your default rules allow `list_files` and `read_file`, so the server approves the calls and each says which rule did.
2. It asks to run `npm test`. The approval card offers once, for this session or always, for the command's pattern (`npm test*`), and an edit of the command first. "For this session" leaves a rule.
3. It proposes a fix across three files. In `DiffReview` you accept or reject each hunk or a whole file, comment on lines and mark files viewed. `reviewToolOutput` sends the agent each file as applied, the hunks you rejected and your comments.
4. It quotes your comments and proposes a revision, built on the files as you applied them. The scripted agent revises whatever the comment says; a real model reads it.
5. It runs the tests again on your session rule, commits on a default rule, and tries to push. The server's rule denies `git push*`, and the card says it was the server's rule, not yours.

Beside the run: the agent's status and the run meter (tokens, estimated cost, time to first token), your rules (remove one, clear the session's, or reset them; a default rule you remove stays removed), every decision with who or which rule made it, and the files the run changed. At the end, the run's changes as one review, with a button in its header that copies them as a patch.

## How it works

| File                                                   | What it is                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`app/api/agent/route.ts`](app/api/agent/route.ts)     | The route: `streamText` with the tools, `toolApproval` from the rules, usage as message metadata                 |
| [`lib/approval.ts`](lib/approval.ts)                   | `toToolApproval`: the server's rules first, then yours (sent with each request), and a person decides the rest   |
| [`lib/rules.ts`](lib/rules.ts)                         | The server's rule (no pushes) and your default rules                                                             |
| [`lib/transport.ts`](lib/transport.ts)                 | What each request carries besides the messages: the agent to use, and your rules from `policy.getRules()`        |
| [`lib/tools.ts`](lib/tools.ts)                         | `list_files`, `read_file`, `run_command`, and `review_changes` with no `execute`: the page answers it            |
| [`lib/shell.ts`](lib/shell.ts)                         | `npm test`, `git status`, `git diff`, `git commit` and `git push`, simulated over the files                      |
| [`lib/workspace.ts`](lib/workspace.ts)                 | The repository as the reviews left it, rebuilt from the messages on every request                                |
| [`lib/scripted-agent.ts`](lib/scripted-agent.ts)       | The scripted agent: a language model that reads where the run is from the tool results and streams the next step |
| [`lib/model.ts`](lib/model.ts)                         | The scripted agent, or `openai(OPENAI_MODEL)` for a live run, and the agent's instructions                       |
| [`lib/project.ts`](lib/project.ts)                     | The repository the agent works in, and the task. The scripted agent plays this task; a real model takes any      |
| [`components/agent-app.tsx`](components/agent-app.tsx) | The page: `useChat`, `useApprovalPolicy` with your default rules, `AgentMessage`, `AgentStatus`, `RunMeter`      |
| [`components/review.tsx`](components/review.tsx)       | `review_changes` as a `DiffReview`, then what was applied                                                        |
| [`components/panels.tsx`](components/panels.tsx)       | Your rules, the decisions, the files, and the run's changes, with "Copy as a patch" (`toPatch`) in the review    |

Nothing touches your disk or runs in a shell: the repository lives in memory, the commands are simulated, and each review's result carries the files as applied, so the server keeps no state between requests. Rules from the page are the person's own choices for their run; the server's rules hold whatever the page sends. The page sends its rules as plain data (`getRules()` uses `toPlainRules`): a rule with a `when` is code, so it stays on the page, which answers the calls it covers when the server asks.

The scripts build with webpack (`next dev --webpack`), so the app also builds where Next.js has no native compiler for the platform and uses its WebAssembly one, which Turbopack can't run on.

## What an approval is

An approval is the person's answer to the agent: it keeps the agent from doing what the person didn't agree to. It doesn't protect the server from whoever calls it. The route takes the run's history from the request, so a caller can send an approved call the model never proposed, or a review with any files in it, and AI SDK 7 runs the call. `validateUIMessages` checks the messages' shape, not where they came from.

Here that costs nothing: the commands are simulated, and the files are the caller's own. Before you give the tools real effects:

- Run them in a sandbox, with only the access a run needs.
- Keep the rules that must hold on the server, as `lib/rules.ts` does. `toolApproval` decides again on every approved call, so a forged approval doesn't get past them.
- Set `experimental_toolApprovalSecret` in `streamText` if you don't need edited arguments. The server then signs each call it asks about and refuses an approval for any other call, including a command edited on the card, which this app offers.

## Tests

`npm test` plays the whole scripted run headless, through AI SDK's `Chat` and the page's transport against the route, and checks the rules, the simulated commands, and what the page sends and keeps. The live path runs against a stub in place of `@ai-sdk/openai`, so no request leaves the machine: a key on the server without `LIVE_MODE=1` never starts it, and with it, only a request that asks for the model does. Two tests send an approval for a call the model never proposed: it runs, unless the server's rule denies it.

In this repository the example builds against the local library (see `overrides` in `pnpm-workspace.yaml`). CI runs its tests and [`scripts/smoke-coding-agent.mjs`](../../scripts/smoke-coding-agent.mjs), which builds a copy of it against the packed package and drives the run in Chrome, on a desktop and a phone, with axe. Copied on its own, it installs `signoff-ui` from npm at the range in `package.json`, which each release moves to the version it publishes.
