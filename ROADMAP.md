# Roadmap

signoff-ui is built in the open, and this page is the plan: what is in review, what comes next, and what waits until someone needs it. To weigh in, add a reaction or a comment on an item's issue: that decides what gets built first, and it is what moves an item out of "Waiting for your feedback".

## In review

Nothing from this roadmap right now. Open pull requests are [on GitHub](https://github.com/dgesteves/signoff-ui/pulls).

## Next

### Approvals

- Untrusted text, second pass: a command padded with many lines of visible filler gets a cap, and link text that only looks like a domain (`JSON.parse`) gets no host badge. [#176](https://github.com/dgesteves/signoff-ui/issues/176)

### Review

- Bring your own diff renderer: `useDiffReview` holds the review while @pierre/diffs draws it, plus a "vs diff viewers" table. [#177](https://github.com/dgesteves/signoff-ui/issues/177)
- A Wrap lines toggle in `DiffReview`, for long lines in a wide review (narrow reviews already wrap). [#178](https://github.com/dgesteves/signoff-ui/issues/178)

### Run, timeline and messages

- Run state that adds up: a tool a person answers reads "Reviewed" instead of a duration, the meter shows only this turn's usage, and a rule's denial is not blamed on the person. [#179](https://github.com/dgesteves/signoff-ui/issues/179)
- Accessibility beyond the card and the review: code and JSON left to right in the timeline and in Markdown, a spoken "Copied", an urgent mode for `AgentStatus`, and touch range selection. [#180](https://github.com/dgesteves/signoff-ui/issues/180)

### API and styling

- One name per concept (old names kept as aliases for a release), refs on every root, a documented table of `data-slot` and state attributes, and your `onKeyDown` no longer turns the shortcuts off. [#181](https://github.com/dgesteves/signoff-ui/issues/181)
- CSS `@scope` for `styles.css`, in place of the long selector each rule carries. [#46](https://github.com/dgesteves/signoff-ui/issues/46)

### Adapters and recipes

- AG-UI answers that hold up: one resume per interrupt, a failed resume rolls back, and an expired interrupt can only be cancelled. [#182](https://github.com/dgesteves/signoff-ui/issues/182)
- A "Coding agent SDKs" page: the Claude Agent SDK's `canUseTool`, OpenAI Agents JS interruptions, and Codex through codex-acp. [#183](https://github.com/dgesteves/signoff-ui/issues/183)
- More of the Works with table tested in CI: the assistant-ui starter, Mastra, Cloudflare Agents and Vercel Eve. [#184](https://github.com/dgesteves/signoff-ui/issues/184)

### Registry

- Registry items pinned to a release with dependency ranges, an `acp` item, then a `quickstart` block that drops a working run into a Next.js app. [#185](https://github.com/dgesteves/signoff-ui/issues/185)

### Docs and site

- An API index generated from the types, every export per entry point, and contributor docs that cover the browser checks. [#186](https://github.com/dgesteves/signoff-ui/issues/186)
- Theming, Changelog, Troubleshooting and Examples pages, and a short component index with each component's preview and code. [#187](https://github.com/dgesteves/signoff-ui/issues/187)
- The site's Ask (⌘K) on the current ondocs release, where Enter follows a citation from the keyboard. [#188](https://github.com/dgesteves/signoff-ui/issues/188)

### Project

- Checks on real devices: an iPhone, VoiceOver, NVDA and Firefox on macOS. Help wanted. [#190](https://github.com/dgesteves/signoff-ui/issues/190)

### Good first issues

Comment on one before you start. [CONTRIBUTING.md](CONTRIBUTING.md) has the checks to run.

- `Sources`: lay out cards by the container's width, not the screen's. [#191](https://github.com/dgesteves/signoff-ui/issues/191)
- Docs tables: join the tab order only while they scroll. [#192](https://github.com/dgesteves/signoff-ui/issues/192)
- Tests for `Reasoning`: following the stream, the reader's toggle, the measured time. [#193](https://github.com/dgesteves/signoff-ui/issues/193)
- Drop tailwind-merge, or teach it the kit's classes. [#47](https://github.com/dgesteves/signoff-ui/issues/47)
- Document ESM only for Jest users. [#48](https://github.com/dgesteves/signoff-ui/issues/48)
- An AI Elements example app with `DiffReview` and approvals, runnable with no key. [#40](https://github.com/dgesteves/signoff-ui/issues/40)

## Waiting for your feedback

These get built when someone who needs them says so on the issue.

- ACP in the browser: a bridge to a local agent, `useAcpSession`, and hunk-level review for agents that write through the client. Moves when a team building a web ACP client wants it. [#194](https://github.com/dgesteves/signoff-ui/issues/194)
- A TanStack AI adapter. Moves when TanStack AI users ask, or someone offers to help keep it current. [#195](https://github.com/dgesteves/signoff-ui/issues/195)
- LangGraph `useStream` converters for LangChain's human-in-the-loop interrupts. Moves when LangGraph JS users ask; today LangGraph works through AG-UI when the interrupt carries the tool call's id. [#196](https://github.com/dgesteves/signoff-ui/issues/196)
- Composable parts: `useApprovalCard` and the pieces of `DiffReview` as exports. Moves when people building their own UI say which parts they need. [#197](https://github.com/dgesteves/signoff-ui/issues/197)
- Registry items built on your own shadcn/ui Button, Input and Textarea. Moves when registry users ask for it. [#198](https://github.com/dgesteves/signoff-ui/issues/198)

## Released

Since this roadmap was published. Each release's changes are in the [changelog](packages/signoff-ui/CHANGELOG.md).

- **0.11.0**: Accessibility and touch in the approval card and the review: Approve all keeps focus, a focused card says what it will run, code reads left to right on right-to-left pages, buttons show in forced colours, and fields no longer zoom on iOS. [#174](https://github.com/dgesteves/signoff-ui/pull/174)
- **0.10.1**: Risk levels from a tool's MCP annotations, and a recipe that puts an organization's policy ahead of a person's rules. [#172](https://github.com/dgesteves/signoff-ui/pull/172)
- **0.10.1**: `ai` becomes an optional peer, so an app that uses only the AG-UI or ACP entries no longer installs the AI SDK. [#173](https://github.com/dgesteves/signoff-ui/pull/173)

Docs, examples and CI, which take effect on `main` without a release:

- Support tiers (tested in CI, or documented only), and new integrations wait until Thursday 2026-11-19, four weeks after launch, unless someone asks for one. [#175](https://github.com/dgesteves/signoff-ui/pull/175)
- The examples do what their READMEs say: each new message restarts the quickstart's scripted run, and the examples pin signoff-ui. [#171](https://github.com/dgesteves/signoff-ui/pull/171)
- `pnpm audit` in CI, because GitHub's dependency alerts can't read this repository's lockfile. [#211](https://github.com/dgesteves/signoff-ui/pull/211)

## Not planned

- A public live mode on the site: it would spend a shared model budget on every visitor, and the scripted run shows the product with no key.
- Moving the demo media out of git: it would not shrink the history a clone already downloads, and rewriting history breaks forks. Say so in an issue if clone size gets in your way.
- A suite brand, more renames or a shared site kit: package listings and redirects depend on the current names.

Bugs go in [issues](https://github.com/dgesteves/signoff-ui/issues), questions and ideas in [Discussions](https://github.com/dgesteves/signoff-ui/discussions), and security reports through [private reporting](https://github.com/dgesteves/signoff-ui/security/advisories/new). Released versions are on [npm](https://www.npmjs.com/package/signoff-ui), with the [changelog](packages/signoff-ui/CHANGELOG.md).
