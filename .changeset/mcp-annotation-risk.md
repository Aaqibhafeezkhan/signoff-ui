---
'signoff-ui': patch
---

`riskFromMcpAnnotations(annotations)`, in `signoff-ui/core` and the main entry, gives an approval card a risk level from what an MCP server says about its tool: `high` for `destructiveHint: true`, `low` for `readOnlyHint: true`, and `medium` for `readOnlyHint: false` or `openWorldHint: true`. Only hints the server set count, so a tool with no annotations still shows no risk, rather than the `high` the MCP spec's defaults would give it. With AI SDK 7's MCP client, read them from a call's part as `part.toolMetadata?.annotations`. It is a hint, not a guarantee: a server you don't trust can mark any tool read-only. `RiskLevel` is now exported from `signoff-ui/core` too. The `useApprovalPolicy` docs add a recipe for an organization's `@ai-sdk/policy-opa` policy first, with a person's rules deciding the calls it has no rule for.
