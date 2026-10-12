# Coding agent

The signoff-ui reference app: a coding agent working in the background on a small repository. It asks before it runs commands, your approval rules answer the calls they cover, and nothing it writes lands until you apply it in a review. Your comments go back to the agent, and it revises.

[Open in StackBlitz](https://stackblitz.com/github/dgesteves/signoff-ui/tree/main/examples/coding-agent)

As of October 2026, StackBlitz opens the code but the preview fails: its WebContainers render no App Router page on Next.js 15 or later (Next.js stops with "Expected workStore to be initialized"), whatever the app, while Next.js 14 renders. Locally, and copied with `create-next-app`, the app runs as it is.

```bash
npm install
npm run dev   # http://localhost:3400
```

It needs no API key: a scripted agent plays the run, the same way every time. For a real model too, copy `.env.example` to `.env.local` and set `OPENAI_API_KEY` (and `OPENAI_MODEL` for a model other than `gpt-5.4-mini`): the page then offers both, with the same tools, rules and reviews. A live run uses your key.

To start an app of your own from it:

```bash
npx create-next-app@latest my-agent --example https://github.com/dgesteves/signoff-ui/tree/main/examples/coding-agent
```

## The run

The task: `slugify('Crème brûlée')` returns `cr-me-br-l-e`, and should return `creme-brulee`.

1. The agent lists and reads files. Your default rules allow `list_files` and `read_file`, so the server approves the calls and each says which rule did.
2. It asks to run `npm test`. The approval card offers once, for this session or always, for the command's pattern (`npm test*`), and an edit of the command first. "For this session" leaves a rule.
3. It proposes a fix across three files. In `DiffReview` you accept or reject each hunk or a whole file, comment on lines and mark files viewed. `reviewToolOutput` sends the agent each file as applied, the hunks you rejected and your comments.
4. It quotes your comments and proposes a revision, built on the files as you applied them. The scripted agent revises whatever the comment says; a real model reads it.
5. It runs the tests again on your session rule, commits on a default rule, and tries to push. The server's rule denies `git push*`, and the card says so.

Beside the run: the agent's status and the run meter (tokens, estimated cost, time to first token), your rules (remove one, clear the session's, or reset them), every decision with who or which rule made it, and the files the run changed. At the end, the run's changes as one review, and a patch to copy.

## How it works

| File                                                   | What it is                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`app/api/agent/route.ts`](app/api/agent/route.ts)     | The route: `streamText` with the tools, `toolApproval` from the rules, usage as message metadata                 |
| [`lib/approval.ts`](lib/approval.ts)                   | `toToolApproval`: the server's rules first, then yours (sent with each request), and a person decides the rest   |
| [`lib/rules.ts`](lib/rules.ts)                         | The server's rule (no pushes) and your default rules                                                             |
| [`lib/transport.ts`](lib/transport.ts)                 | What each request carries besides the messages: the agent to use, and your rules                                 |
| [`lib/tools.ts`](lib/tools.ts)                         | `list_files`, `read_file`, `run_command`, and `review_changes` with no `execute`: the page answers it            |
| [`lib/shell.ts`](lib/shell.ts)                         | `npm test`, `git status`, `git diff`, `git commit` and `git push`, simulated over the files                      |
| [`lib/workspace.ts`](lib/workspace.ts)                 | The repository as the reviews left it, rebuilt from the messages on every request                                |
| [`lib/scripted-agent.ts`](lib/scripted-agent.ts)       | The scripted agent: a language model that reads where the run is from the tool results and streams the next step |
| [`lib/model.ts`](lib/model.ts)                         | The scripted agent, or `openai(OPENAI_MODEL)` when `OPENAI_API_KEY` is set, and the agent's instructions         |
| [`lib/project.ts`](lib/project.ts)                     | The repository the agent works in, and the task. The scripted agent plays this task; a real model takes any      |
| [`components/agent-app.tsx`](components/agent-app.tsx) | The page: `useChat`, `useApprovalPolicy`, `AgentMessage`, `AgentStatus`, `RunMeter`                              |
| [`components/review.tsx`](components/review.tsx)       | `review_changes` as a `DiffReview`, then what was applied                                                        |
| [`components/panels.tsx`](components/panels.tsx)       | Your rules, the decisions, the files, and the run's changes with `toPatch`                                       |

Nothing touches your disk or runs in a shell: the repository lives in memory, the commands are simulated, and each review's result carries the files as applied, so the server keeps no state between requests. Rules from the page are the person's own choices for their run; the server's rules hold whatever the page sends.

The scripts build with webpack (`next dev --webpack`): Turbopack needs native bindings, which StackBlitz's WebContainers don't have. Left to itself StackBlitz starts `next dev`, with Turbopack, so `.stackblitzrc` has it start `npm run dev`.

## Tests

`npm test` plays the whole scripted run headless, through AI SDK's `Chat` against the route, and checks the rules and the simulated commands. The live path runs against a stub in place of `@ai-sdk/openai`, so no request leaves the machine.

In this repository the example builds against the local library (see `overrides` in `pnpm-workspace.yaml`). CI runs its tests and [`scripts/smoke-coding-agent.mjs`](../../scripts/smoke-coding-agent.mjs), which builds a copy of it against the packed package and drives the run in Chrome, on a desktop and a phone, with axe. Copied on its own, it installs `signoff-ui` 0.6 from npm.
