---
'signoff-ui': patch
---

`ai` is an optional peer dependency, so npm and pnpm no longer install the AI SDK, its provider packages and zod in an app that doesn't use them: an AG-UI or ACP app now installs 11 fewer packages, about 25 MB. `signoff-ui/ag-ui` and `signoff-ui/acp` declare the AI SDK types they return (`UIMessage`, `ChatStatus` and token usage) themselves, so they type-check without `ai`, and their messages still go to `AgentMessage` and `useChat` as they are, on AI SDK 6 and 7. The components' props keep the AI SDK's own types: without `ai`, TypeScript reads them as `any`, so install it, as a dev dependency if nothing else needs it, to have them checked. The shadcn `ag-ui` item no longer lists `ai` either.
