Every export of signoff-ui, by entry point, read from the package's published types when the site builds, so the page lists exactly what the package exports.

The components, the hooks and the types they take each have a component page, with props in full, defaults, examples, keyboard and accessibility, and each entry point links them there. Every other export is here, with its declaration and its description as your editor shows them. Import an export from the entry point it is listed under. The main entry, `signoff-ui`, also exports everything in `signoff-ui/core`.

## signoff-ui

The components and hooks. They are client modules, each with its own `'use client'` directive. For the pure helpers in server code, import from `signoff-ui/core`.

<!-- exports: signoff-ui -->

## signoff-ui/core

The pure helpers, with no React and no `'use client'`, so Server Components, Route Handlers and plain Node can call them: approval rules, the review's result and what goes back to the agent, tool and source parts, usage and cost, untrusted text and URLs, and the labels.

<!-- exports: signoff-ui/core -->

## signoff-ui/ag-ui

[AG-UI agents](/docs/ag-ui): `useAgUiAgent`, and the converters and the run reducer it wires to an `@ag-ui/client` agent. Those are pure, for a store of your own.

<!-- exports: signoff-ui/ag-ui -->

## signoff-ui/acp

The [Agent Client Protocol](/docs/acp), with no React: a prompt turn's `session/update` notifications and permission requests folded into a `UIMessage`, a tool call's diff content as `DiffReview` files, and the answer to `session/request_permission` from the approval card's decision.

<!-- exports: signoff-ui/acp -->

## signoff-ui/assistant-ui

Tool UIs for [assistant-ui](/docs/chat-ui#assistant-ui): `signoffTools()` goes in `MessagePrimitive.Parts`' `components.tools`. `@assistant-ui/react` is an optional peer, and only its types are used.

<!-- exports: signoff-ui/assistant-ui -->

## signoff-ui/custom-markdown

`AgentMessage` and `Reasoning` for a Markdown renderer of your own, such as Streamdown, without react-markdown: pass `renderMarkdown`, or set one with `MarkdownRendererProvider`. Without one, text shows as it is.

<!-- exports: signoff-ui/custom-markdown -->
