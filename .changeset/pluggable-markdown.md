---
'signoff-ui': minor
---

`AgentMessage` and `Reasoning` can render text with your own Markdown renderer, such as Streamdown, through a `renderMarkdown` prop or `MarkdownRendererProvider`, and `signoff-ui/custom-markdown` exports them without react-markdown, so it stays out of your bundle.
