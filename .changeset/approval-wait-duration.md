---
'signoff-ui': patch
---

`ToolCallTimeline` and `useToolTimings` leave the time spent waiting for an approval out of a call's duration also when the call showed as running before its approval request arrived, as it does on AI SDK 6 and on an AG-UI interrupt. An approved call's duration used to include the person's wait there, so a command that ran for 17 ms after a 4 second wait read as about 4 seconds.
