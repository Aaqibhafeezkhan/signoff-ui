---
'signoff-ui': patch
---

`fromAgUiMessages`, and so `useAgUiAgent`: a sub-agent's user message stays out of the person's turn. A sub-agent that keeps its own context posts the task its parent gave it as a user message with its `subagentRunId`, which AG-UI allows. That message was read as the person's: it showed as a user bubble with the sub-agent's prompt in it, and split the parent's answer into two assistant messages, so `deriveAgentState` read only the second half. It is now left out of the conversation, and the parent's turn stays one message, with the sub-agent's `data-signoff-subagent` part in it.
