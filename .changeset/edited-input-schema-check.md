---
'signoff-ui': patch
---

`setToolInput` puts the edited arguments in the approval's `inputSchemaInput` too, when it has one. AI SDK 7 keeps what the model sent there when the tool's schema changed it, by filling in a default, coercing a value or dropping a key it doesn't name, and checks the approved call against it. Approving an edit of such a call failed with `AI_InvalidToolInputError` ("Approved tool input does not match the validated schema output"), and the tool never ran. The server still runs the edit through the schema, so an edit must keep the fields the schema fills in.
