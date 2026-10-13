signoff-ui is a set of React components for the step where a person signs off on what an agent does: reviewing the edits it proposes, across files and hunk by hunk, and approving or denying the calls that need a person. The result goes back to the agent as something it can act on: each file with only the accepted hunks applied, the hunks rejected and the reviewer's comments on lines, or an approval with the reason for a denial. The components render the message parts the AI SDK's `useChat` already gives you, AG-UI agents and Agent Client Protocol (ACP) turns through adapters, and assistant-ui's tool calls through a binding of their own, inside the chat UI you already have.

It works with any model and costs nothing extra. The kit calls no model, needs no API key and makes no network requests of its own. Your backend picks the model and holds the keys: OpenAI GPT, Anthropic Claude, Google Gemini, xAI Grok, Mistral or a local model through any AI SDK provider, or an agent on any AG-UI framework (LangGraph, CrewAI, Mastra and the rest). Switching providers is [one line in your route](/docs/getting-started#choosing-a-model); the components don't change.

## Why it exists

Coding and editing agents propose changes across several files and ask to run commands that can break things, and someone has to sign off on both. The questions a person has at that point are specific:

<!-- cards -->

- **What did it change, and do I accept it?** Hunk by hunk or file by file, not all or nothing, with comments on lines, from the keyboard, with the result fed back to the agent.
- **Should I let it do that?** What exactly will run, how risky it is, and a fast way to say yes, no, or no with a reason. And when a rule decided on its own, that it was a rule and not a person.
- **What is it doing, and what did that cost?** Which calls ran, how long each took, which failed and why, and what the run cost in tokens and time.

The chat kits most teams use stop short of the first two: assistant-ui's reviewable diff takes one file's hunks, already split, and its apply returns nothing, and AI Elements has no diff and a confirm/deny you wire up yourself. signoff-ui does those two in depth, and has the rest as supporting pieces. [How it compares](/docs/comparison) has the details, including what those kits do better.

## What's in it

For review and approval:

| Export                             | What it renders                                                                                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DiffReview`                       | Unified or split review of edits across files, from their contents or a patch, with word-level highlights; returns each file with only the accepted hunks applied, the rejected hunks and comments on lines. Your own controls go in its header (`actions`) |
| `useDiffReview`                    | The same review without its markup: its state, keyboard and result, for your own design system                                                                                                                                                              |
| `ApprovalCard`, `ToolApprovalCard` | Human-in-the-loop approval with a preview of what will run, a risk level when given, deny with a reason, and automatic decisions shown as such                                                                                                              |
| `useApprovalPolicy`                | Approval rules: once, for the session or always, by tool and argument pattern, with storage and an audit trail. `getRules` sends them with each request, and `parseApprovalRules` from `signoff-ui/core` checks them in the route                           |

Supporting pieces:

| Export             | What it renders                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentMessage`     | A whole assistant message: reasoning, streaming markdown, consecutive tool calls as one timeline, approvals inline, files and sources                                  |
| `ToolCallTimeline` | Every tool call with its state, a measured duration and a waterfall, and sub-agents nested under the call that started them; errors inline, input and output on demand |
| `RunMeter`         | Tokens, estimated cost, time to first token, active time and prompt-cache hit rate                                                                                     |
| `AgentStatus`      | The run's state in one pill, announced to screen readers                                                                                                               |
| `Sources`          | Citations as chips or cards, linked from `[n]` markers in the text                                                                                                     |
| `useAgUiAgent`     | An AG-UI agent's run as AI SDK messages, status, usage and approvals                                                                                                   |
| `signoff-ui/acp`   | An ACP prompt turn as a message, its permission requests as approval cards and its edits as `DiffReview` files                                                         |
| `signoffTools`     | assistant-ui tool UIs, from `signoff-ui/assistant-ui`: a `DiffReview` for review tools and the approval card at an approval gate                                       |

`Markdown`, `Reasoning` and `JsonView` are exported on their own too. `AgentMessage` and `Reasoning` can render text with your own Markdown renderer (`renderMarkdown`), and `signoff-ui/custom-markdown` exports them without react-markdown. There are also hooks such as `useRunTiming` and pure helpers such as `deriveAgentState`, `addUsage`, `estimateCost` and `applyHunks`. The helpers are also in `signoff-ui/core`, which has no React, for Route Handlers and Server Components.

Every word the components show or announce is a label: `SignoffLabelsProvider` takes a translation of them all, or a few, and [Labels and translations](/docs/labels) has a complete one in Portuguese.

## How it reads a run

Each AI SDK 6 or 7 message part has a place:

| AI SDK 6 / 7                                                   | Rendered as                                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `text` (`state: 'streaming' \| 'done'`)                        | `Markdown`, repaired while streaming, with a caret and `[n]` citation links                              |
| `reasoning`                                                    | `Reasoning`: open while streaming, then "Thought for 1.7s"                                               |
| `tool-*` / `dynamic-tool`, `input-streaming`                   | Timeline row "Preparing", partial input visible                                                          |
| `input-available`                                              | "Running", live duration ("Stopped" once the run is no longer `active`)                                  |
| `approval-requested` (`approval.id`, `approval.requestReason`) | "Needs approval" and a `ToolApprovalCard` that calls `addToolApprovalResponse({ id, approved, reason })` |
| `approval-responded`                                           | "Running" if approved, "Denied" if not                                                                   |
| `output-available` (`preliminary: true`)                       | "Running", partial output                                                                                |
| `output-available`                                             | Done, output in a JSON view or your `renderOutput`                                                       |
| `output-error` (`errorText`)                                   | "Failed", the error inline, announced                                                                    |
| `output-denied`                                                | "Denied", with the user's reason, or "Blocked by policy" when the approval was automatic                 |
| client-side tool, `input-available`                            | Whatever `renderTool` returns, such as a `DiffReview` that calls `addToolOutput`                         |
| `source-url` / `source-document`                               | `Sources`                                                                                                |
| `file`                                                         | An image preview (`data:` and `blob:` URLs, or as `allowedImageHosts` allows) or a file link             |
| `data-*`                                                       | `renderData`                                                                                             |
| `message.metadata.usage` (`LanguageModelUsage`)                | `RunMeter`                                                                                               |
| `useChat().status`                                             | `AgentStatus` through `deriveAgentState`, timing through `useRunTiming`                                  |

The kit depends on `ai` for types only. Part detection (`isToolPart`, `getToolPartName`) mirrors the SDK's runtime helpers, and a test checks they agree.

The [playground](/) doesn't fake any of this. Its scripted agent is a `ChatTransport` that streams real `UIMessageChunk`s through `useChat`, so the SDK assembles the parts, merges usage metadata, and drives the approval and client-tool round trips as it would against a server.

## Design decisions

<!-- cards -->

- **Review returns code.** `DiffReview` does not stop at a decision map: `onSubmit` includes each file with only the accepted hunks applied (`applyHunks`), unreviewed hunks left out, plus the rejected hunks and the comments with their lines. That makes it a client-side tool whose result goes straight back to the model, through `reviewToolOutput`.
- **Automatic is not a person.** Decisions a `toolApproval` rule makes on its own never prompt or take focus, and read "Auto-approved" or "Blocked by policy", so whoever reads the run can tell who decided.
- **Shortcuts scoped to focus.** Global single-key shortcuts are an accessibility problem and fight with text inputs; scoping them to the component avoids both, and keeps them within WCAG 2.1.4. Critical approvals need a second press.
- **A run, not a message.** The unit of UI is the run: many tool calls, a pause for permission, a review, a summary. Consecutive tool parts become one timeline instead of a stack of cards, and status and telemetry live outside the message.
- **Timings are measured, not invented.** Message parts carry no timestamps, so `useToolTimings` records state changes on the client. Execution time starts when a call is approved, not when it was proposed, so waiting on a person never reads as a slow tool. Calls already settled when first seen (restored history) get no duration rather than a fake zero. You can pass server-measured `timings` instead.
- **Errors inline, details on demand.** A failed call shows its message under the row and stays collapsed. Auto-expanding failures (`expandErrors`) pushed everything else off screen.
- **Cyan and magenta diffs, not green and red.** They stay distinguishable under the common red-green color-vision deficiencies. The + and − glyphs and screen-reader prefixes carry the meaning regardless of color.
- **Cache hit rate over tokens per second.** Throughput looked precise but mixed tool time into generation speed. For agents, cached input is the bigger cost lever, so that is what the meter shows.
- **Hydration-safe clocks.** Live durations and waterfall widths render after hydration, so server and client markup always match. Nothing reads the clock while rendering on the server, so pages that render the components prerender under Next.js `cacheComponents`.
- **Type-only dependency on `ai`.** No SDK runtime in the build, while props stay typed to SDK parts. [Performance and limits](/docs/limits) has what each component costs.
- **Styles that stay in their lane.** The npm build ships a precompiled stylesheet for apps without Tailwind v4: unlayered, every rule scoped to the components' own elements, and none of your theme's variables set, so your content inside a component keeps your styles. CI checks it in Chrome next to a global reset, inside a Tailwind v3 build and inside a Tailwind v4 app with its own theme.
- **Two ways to install, one source.** The registry is generated from the same files by `scripts/registry.mjs`, which computes each item's file closure from its imports, so items install by URL or from GitHub without cross-item dependencies. CI fails if `registry.json` drifts. Both keep `'use client'` per module (the build emits one module per source file and checks the directives), so Server Components can render the components and call the pure helpers.

## Use these docs from your agent

These docs are an MCP server at `https://signoff-ui.vercel.app/api/mcp`. Add it to Cursor, VS Code, Claude Code or Claude, and your agent can search and read them while it works. Its `search`, `fetch` and `list_pages` tools call no model, so they need no key.

[![Cursor: Add server](https://img.shields.io/badge/Cursor-Add_server-181c22?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/en/install-mcp?name=signoff-ui&config=eyJ1cmwiOiJodHRwczovL3NpZ25vZmYtdWkudmVyY2VsLmFwcC9hcGkvbWNwIn0%3D) [![VS Code: Add server](https://img.shields.io/badge/VS_Code-Add_server-007ACC?style=flat-square)](https://insiders.vscode.dev/redirect/mcp/install?name=signoff-ui&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fsignoff-ui.vercel.app%2Fapi%2Fmcp%22%7D) [![Claude: Add connector](https://img.shields.io/badge/Claude-Add_connector-b4532a?style=flat-square&logo=claude&logoColor=white)](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=signoff-ui&connectorUrl=https%3A%2F%2Fsignoff-ui.vercel.app%2Fapi%2Fmcp)

In Claude Code:

```bash
claude mcp add --transport http signoff-ui https://signoff-ui.vercel.app/api/mcp
```

To read them instead, [`/llms.txt`](https://signoff-ui.vercel.app/llms.txt) lists every page and [`/llms-full.txt`](https://signoff-ui.vercel.app/llms-full.txt) has them all in one file. Every page is also Markdown at its own address plus `.md`.

## Next steps

- [Getting started](/docs/getting-started): install, styles, a first run in Next.js with a review and an approval, AI SDK 6 or 7, and theming.
- [Inside your chat UI](/docs/chat-ui): with assistant-ui, AI Elements or your own components.
- [AG-UI agents](/docs/ag-ui): LangGraph, CrewAI, Mastra and other AG-UI agents through `useAgUiAgent`.
- [Agent Client Protocol](/docs/acp): an ACP prompt turn, its permission requests and its edits, through `signoff-ui/acp`.
- [useApprovalPolicy](/docs/components/use-approval-policy): approval rules on the page and in your route.
- [useDiffReview](/docs/components/use-diff-review): the review in your own markup.
- [Components](/components): each component in isolation, with install snippets.
