# Next.js quickstart

The [README quickstart](../../README.md#quickstart), running: a Next.js 16 app (`cacheComponents` on, as in new apps) with an AI SDK 7 route, against a scripted model, so it needs no API key. One run covers a tool call, a failed tool, a diff review across two files whose result goes back to the agent, an approval, the resumed run, sources and the run meter.

```bash
pnpm install
pnpm dev   # http://localhost:3200
```

Send any message: the scripted model ignores it and plays the same run every time. Accept or reject the hunks, then approve or deny the command, to see the different endings.

| File                                             | What it is                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [`app/agent-run.tsx`](app/agent-run.tsx)         | The client: `useChat`, the components, the review in `renderTool`, and a minimal composer                   |
| [`app/page.tsx`](app/page.tsx)                   | Renders it in a `<Suspense>` boundary, which `useChat` needs under `cacheComponents`                        |
| [`app/api/chat/route.ts`](app/api/chat/route.ts) | The route: tools (`review_changes` without `execute`), an approval policy, `stopWhen`, usage as metadata    |
| [`lib/mock-model.ts`](lib/mock-model.ts)         | The scripted model (`MockLanguageModelV4` from `ai/test`)                                                   |
| [`app/static/page.tsx`](app/static/page.tsx)     | A finished run rendered from a Server Component. `next build` fails if a component is not safe to prerender |

For a real model, install a provider (`pnpm add @ai-sdk/openai`), set its API key, and replace `createMockModel()` in the route with `openai('gpt-5.4-mini')`.

Before `run_command` runs anything real, know what the approval does: it keeps the agent from running a command the person didn't agree to, and it doesn't protect your server from whoever calls it. The route takes `messages` from the request as they come, so a caller can send an approved `run_command` the model never proposed, and the AI SDK runs it. Run the tool in a sandbox, and check the messages' shape with `validateUIMessages` from `ai`. Keep the rules that must hold in `toolApproval` on the server: it decides again on every approved call. If you don't need edited arguments, set `experimental_toolApprovalSecret` in `streamText`: the server then refuses an approval for any call it didn't ask about, an edited one included. [`examples/coding-agent`](../coding-agent#what-an-approval-is) validates its messages and keeps a rule on the server.

In this repository the example builds against the local library (see `overrides` in `pnpm-workspace.yaml`); CI builds it and runs [`scripts/smoke-nextjs-minimal.mjs`](../../scripts/smoke-nextjs-minimal.mjs), which applies the review and approves the command in Chrome and waits for the final answer. Copied on its own, it installs the latest `signoff-ui` from npm.
