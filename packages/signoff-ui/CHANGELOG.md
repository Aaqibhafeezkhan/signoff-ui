# signoff-ui

Until 0.4.3 this package was published as `@dgesteves/agent-ui-kit`. Its entries below keep the links and names of that time.

## 0.7.0

### Minor Changes

- [#84](https://github.com/dgesteves/signoff-ui/pull/84) [`cb0bae9`](https://github.com/dgesteves/signoff-ui/commit/cb0bae9e9dc5e9d1cd5249a65c926e27956850df) Thanks [@dgesteves](https://github.com/dgesteves)! - `AgentMessage` and `Reasoning` can render text with your own Markdown renderer, such as Streamdown, through a `renderMarkdown` prop or `MarkdownRendererProvider`, and `signoff-ui/custom-markdown` exports them without react-markdown, so it stays out of your bundle.

- [#85](https://github.com/dgesteves/signoff-ui/pull/85) [`2420e62`](https://github.com/dgesteves/signoff-ui/commit/2420e62f0ae1c7e0349bcfdb8ac8bcf3da6039f7) Thanks [@dgesteves](https://github.com/dgesteves)! - `DiffReview` takes an `actions` prop: your own controls, such as a "Copy as a patch" button, in its header next to the layout toggle. They sit in a `data-signoff-slot` element, so `styles.css` leaves them to your CSS, and keys pressed on them don't trigger the review's shortcuts.

- [#83](https://github.com/dgesteves/signoff-ui/pull/83) [`70c341a`](https://github.com/dgesteves/signoff-ui/commit/70c341a7fb876029fe194635803dc7fea16eb8bf) Thanks [@dgesteves](https://github.com/dgesteves)! - `reviewToolOutput` and `reviewResumeEntry` now tell the agent which files the reviewer marked viewed: each such file has `viewed: true`, and the others have no `viewed` key.

- [#86](https://github.com/dgesteves/signoff-ui/pull/86) [`d29ff27`](https://github.com/dgesteves/signoff-ui/commit/d29ff27b95513aba315d83a380e610313bae6570) Thanks [@dgesteves](https://github.com/dgesteves)! - To send a person's approval rules with each request, `policy.getRules()` returns the latest rules as plain data for the transport's `body`, and `parseApprovalRules(rules)` from `signoff-ui/core` checks them in the route before `toToolApproval`.

  `getRules` is a new member of the `ApprovalPolicy` interface. Code that builds its own `ApprovalPolicy` object, rather than using `useApprovalPolicy`, needs to add it.

- [#72](https://github.com/dgesteves/signoff-ui/pull/72) [`5972edc`](https://github.com/dgesteves/signoff-ui/commit/5972edcfae15ae9660d0e8e3702dc04c504033b7) Thanks [@dgesteves](https://github.com/dgesteves)! - Sub-agents nest in the timeline. The AG-UI adapter maps `SUBAGENT_STARTED`, `SUBAGENT_FINISHED` and `SUBAGENT_ERROR`, and the messages and events that carry a `subagentRunId`, into one `data-signoff-subagent` part on the parent message, after the call that started it: `{ subagentRunId, parentToolCallId, name, status, parts }`, with the sub-agent's tool calls and text in the same shapes as the parent's. `ToolCallTimeline`, in `AgentMessage` too, shows it under that call as a collapsed row with its name, its number of calls and its state, which opens to its calls, with the same keys, names and announcements as the others. A sub-agent's call can wait on approval like any: its row opens to the card, `deriveAgentState` reads `awaiting-approval` and "Approve all" includes it. The run state lists the sub-agents (`subagents`), events may arrive in any order, and the part's types (`SubagentPart`, `SubagentData`, `SubagentStatus`) and `isSubagentPart` are exported, so other sources can stream their own. The labels gain `toolCallTimeline.subagent`.

- [#82](https://github.com/dgesteves/signoff-ui/pull/82) [`7a0aa14`](https://github.com/dgesteves/signoff-ui/commit/7a0aa14add2c990c07f643e3d5c747acf4faaa70) Thanks [@dgesteves](https://github.com/dgesteves)! - `toToolApproval(rules, { reason })` words the reason for a call a rule decides, so the server's rules and a person's own can each say whose rule it was; without `reason`, the reason is the same as before.

### Patch Changes

- [#92](https://github.com/dgesteves/signoff-ui/pull/92) [`1e9ad7d`](https://github.com/dgesteves/signoff-ui/commit/1e9ad7d1a7a260e3988fd19fa94738612c2a0894) Thanks [@dgesteves](https://github.com/dgesteves)! - `ApprovalCard` (and `ToolApprovalCard`, and the cards in `AgentMessage` through `approvalProps`) no longer approves or denies when Y, S, A, N, Shift+N or ⌘/Ctrl+Enter is pressed on a control in a custom `preview`, or in a menu that `preview` opens in a portal. Those keys go to the control. With `globalShortcut`, ⌘/Ctrl+Enter still approves from anywhere on the page.

- [#81](https://github.com/dgesteves/signoff-ui/pull/81) [`ad50100`](https://github.com/dgesteves/signoff-ui/commit/ad5010039dcc7ac5d5ae7f0cbb680538d5a0f112) Thanks [@dgesteves](https://github.com/dgesteves)! - `useApprovalPolicy`: an `always` rule from `defaultRules` that a person removes now stays removed after a reload, instead of coming back on every load. A default your app adds in a later version still appears. `webStorageRules()` keeps the removed ids under `<key>:removed-defaults` and `memoryRuleStorage()` keeps them in memory; a storage of your own can keep them with the new optional `loadRemovedDefaults()` and `saveRemovedDefaults(ids)`. Rules saved by earlier versions load as before.

- [#94](https://github.com/dgesteves/signoff-ui/pull/94) [`9d8d48a`](https://github.com/dgesteves/signoff-ui/commit/9d8d48a5316585e8606a2b8891d5750533a8c4e5) Thanks [@dgesteves](https://github.com/dgesteves)! - `DiffReview` renders no actions slot for `actions={true}` or `actions=""`, as for `undefined`, `null` and `false`: React renders nothing for them, and the empty slot narrowed the title.

- [#91](https://github.com/dgesteves/signoff-ui/pull/91) [`bcfda1c`](https://github.com/dgesteves/signoff-ui/commit/bcfda1c2ecaac4a8fe255f0d22bc8a41bf7223e2) Thanks [@dgesteves](https://github.com/dgesteves)! - Approval rules match an argument in time proportional to its length times the pattern's. `matchesGlob`, and with it `evaluateRules`, `toToolApproval` and `useApprovalPolicy`, used a regular expression that backtracked: a pattern with a few `*`, such as `*a*a*a*b`, took seconds on an argument of a few hundred characters that it didn't match, and held up the server or the page meanwhile. It now reads the value once and gives the same answers. `globToRegExp` still returns the same `RegExp`, which backtracks.

- [#69](https://github.com/dgesteves/signoff-ui/pull/69) [`34ff527`](https://github.com/dgesteves/signoff-ui/commit/34ff5277c3d2d171e068915be1541d3035cb60a0) Thanks [@dgesteves](https://github.com/dgesteves)! - npm's homepage link for the package is now the website, signoff-ui.vercel.app, instead of the GitHub README.

- [#66](https://github.com/dgesteves/signoff-ui/pull/66) [`89e4314`](https://github.com/dgesteves/signoff-ui/commit/89e431417cccac21571edf21914bb5facc4f4f17) Thanks [@dgesteves](https://github.com/dgesteves)! - `RunMeter` no longer shows a negative number for a moment as a value animates, such as "↑ -89" or "$-0.0002" at the start of a run. A frame that began before the animation counts as its start.

## 0.6.0

### Minor Changes

- [#59](https://github.com/dgesteves/signoff-ui/pull/59) [`782ed22`](https://github.com/dgesteves/signoff-ui/commit/782ed2281faeeb3f492427c2e4e494eba0d62f45) Thanks [@dgesteves](https://github.com/dgesteves)! - `signoff-ui/acp`: render Agent Client Protocol sessions with the components. Pure functions, no React, nothing new to install.

  - **A prompt turn as a message.** `createAcpTurn()`, then `reduceAcpTurn(turn, notification)` for each `session/update`: message and thought chunks become text and reasoning, and tool calls and their updates merge by id. `requestAcpPermission(turn, request)` marks a call as waiting on its `session/request_permission`, `answerAcpPermission(turn, toolCallId, decision)` records the answer, and `endAcpTurn(turn, response)` ends the turn with its `stopReason` (or an error). `toAcpMessage(turn)` is the assistant `UIMessage` for `AgentMessage` and `ToolCallTimeline`: a call waiting on a person is `approval-requested`, its tool call id the approval id, and a denied or cancelled one is `output-denied`.
  - **Diffs as review files.** `fromAcpDiffs(content, { root })` maps a tool call's `{ type: 'diff', path, oldText, newText }` content to `DiffReview` files, relative to the session's `cwd`. `toAcpDiffs` goes back.
  - **The permission converters** (`decisionsFromAcpOptions`, `toAcpPermissionResponse`, `fromAcpPermissionResponse`, `fromAcpPermissionRequest`) are re-exported here. `fromAcpPermissionRequest` now names the tool by ACP 1.8's `name` when the agent sends one, then by `kind` and `title` as before (`acpToolName`). Rules saved against a call's kind (`execute`) no longer match when the agent sends a name (`Bash`): those calls are asked about again, and a `deny-always` rule on the kind needs a rule on the name added to keep blocking them.

  - **`ApprovalCard`'s `ruleScope={false}`** hides the argument patterns a session or always decision would cover, for when the agent keeps what "always" means, as ACP's `allow_always` does. The decision then comes without `args`.

  The types mirror what is read, and a type test checks that `@agentclientprotocol/sdk` 1.8's notifications, permission requests and diff content fit them, and that the responses fit the SDK's. The components page has a demo with a scripted ACP agent.

- [#57](https://github.com/dgesteves/signoff-ui/pull/57) [`66d5c2f`](https://github.com/dgesteves/signoff-ui/commit/66d5c2f438a6190b02d89244f6291bab01affefe) Thanks [@dgesteves](https://github.com/dgesteves)! - `signoff-ui/assistant-ui`: review and approve assistant-ui tool calls.

  - **`signoffTools({ review })`** goes in `MessagePrimitive.Parts`' `components.tools`. A call to one of the `review` tools gets a `DiffReview` once its arguments are in, and the review goes back as the call's result through `addResult` (`reviewToolOutput(review)`), then stays on the page read-only. Any other call at an approval gate gets the approval card, answered through `respondToApproval`. `Fallback` renders the calls with no gate.
  - **`SignoffToolsProvider`**, optional, passes approval rules from `useApprovalPolicy` (once, this session or always, and a call a rule decides is answered without a card once the run has paused for it), labels and risk levels by tool, props for every `DiffReview` and approval card, and `reviewToolOutput`'s options.
  - **`ReviewToolUI` and `ApprovalToolUI`** are the two components, for your own tool components.

  It works with any assistant-ui runtime; it ran end to end with the AI SDK runtime (`@assistant-ui/react-ai-sdk` 1.4) and the local runtime. `@assistant-ui/react` (`^0.15.0`) is an optional peer dependency: the entry imports only its types, and nothing of it reaches the main entry. The shadcn registry has it as the `assistant-ui` item.

  `ToolApprovalCard` with a `policy` no longer answers a call twice when a person's session or always decision adds a rule while the call still reads pending, as it does with a runtime that records the answer a moment later.

- [#63](https://github.com/dgesteves/signoff-ui/pull/63) [`2a7cff8`](https://github.com/dgesteves/signoff-ui/commit/2a7cff80ef73020d6281d7498c81a10fc426aa29) Thanks [@dgesteves](https://github.com/dgesteves)! - `ToolCallTimeline` keeps up with very long runs. At 2,000 calls, appending one took about 105 ms of the main thread until its frame was painted; it now takes about 2.5 ms (12 ms with the CPU six times slower). With a call running, frames dropped to about 50 ms; they now keep the display's pace. The first render goes from about 440 ms to 40 ms.

  - **A long run renders only the calls near the screen.** Past 150 calls, the timeline renders the calls within 800 px of the viewport, in chunks of 25. A chunk away from it is an empty item as tall as its calls, hidden from assistive tech. A chunk holding an open call, a call still going (running, streaming its input or waiting on approval) or focus stays rendered. The calls that render carry `aria-posinset` and `aria-setsize`. Arrow Up and Down, Home and End move between all the calls, scrolling a call that isn't rendered into view and focusing it. Announcements are unchanged. What a call far from the screen renders, including `renderExtra`'s content, unmounts until it comes back near. Shorter timelines render every call, as before.
  - **Only the calls that change render again.** A new call, or a running call's clock, no longer renders every call. The waterfall's bars are placed from each call's times and the timeline's span, set on the bars that are rendered.
  - **The enter animation leaves nothing behind.** `--animate-signoff-enter` fills `backwards`, not `both`: the end state is the same, but a finished animation no longer stays in effect on every element it ran on. A call that renders again as its chunk comes back near the screen doesn't slide in.

### Patch Changes

- [#60](https://github.com/dgesteves/signoff-ui/pull/60) [`ae3d758`](https://github.com/dgesteves/signoff-ui/commit/ae3d758d1b03a360e0ab6a01eac6143f31c1fca6) Thanks [@dgesteves](https://github.com/dgesteves)! - The website and the hosted shadcn registry moved to signoff-ui.vercel.app; the registry URL is now `https://signoff-ui.vercel.app/r/{name}.json`. The old address redirects, so existing `components.json` files and links keep working.

## 0.5.0

### Minor Changes

- [#53](https://github.com/dgesteves/signoff-ui/pull/53) [`ebf330d`](https://github.com/dgesteves/signoff-ui/commit/ebf330d85921df4ab54990ff9d5b83c012ea75f9) Thanks [@dgesteves](https://github.com/dgesteves)! - Approval rules: a person approves once, for the session or always, by tool and argument pattern, and the calls that follow are decided by those rules.

  - **`useApprovalPolicy()`** holds the rules for the page. Each rule covers a tool (a name or a glob), narrowed by argument globs (`{ command: 'npm test*' }`, dotted names for nested arguments) or a test of your own (`when`), and a deny rule wins over an allow rule. In a pattern, `*` never runs past a shell operator (`;`, `&`, `|`, backticks, `<`, `>`, `$(`, line breaks), so `npm test*` does not allow `npm test && rm -rf ~`; `**` matches anything. Session rules stay in memory. `always` rules go to a pluggable `storage`: memory by default, `webStorageRules()` for `localStorage`, or your own `{ load, save }`, which may be async. `onAudit` receives every decision (by a person or by which rule, with the reason and edited arguments), every rule added or removed, and every session cleared.
  - **`ApprovalCard` offers the choices.** `decisions` sets which of `allow-once`, `allow-session`, `allow-always`, `deny-once` and `deny-always` it shows, each a button with a key (Y, S, A, N, Shift+N). A lasting choice shows the argument patterns it will cover, editable, or "Any arguments". `onDecide` receives `{ decision, reason, input, args }`. `ToolApprovalCard` with a `policy` offers every choice, records the rules, answers a call a rule covers without a prompt, and shows it as "Allowed by your rule" with the rule.
  - **Edit the arguments, then approve.** `editable` on `ApprovalCard`, or `onEditInput` on `ToolApprovalCard` (`onToolInputEdit` on `AgentMessage`), opens the arguments as a form (an object of strings, numbers and booleans) or as JSON that must parse. With AI SDK 7, `setToolInput` puts the edited input in the messages, and the server runs the call with it after checking it against the tool's schema and `toolApproval` again. `useAgUiAgent` gains `editInput`, and the resume payload carries the edit as `input`.
  - **Approve all pending.** `ToolApprovalBatch` answers every approval a run waits on at once, with a second press when one of them is critical. `AgentMessage` shows it when two or more are waiting.
  - **The same rules elsewhere.** `toToolApproval(rules)` is AI SDK 7's `toolApproval` function: a matching rule approves or denies on the server, and anything else asks a person. `toToolApprovalResponse` answers `addToolApprovalResponse`. For the Agent Client Protocol's `session/request_permission`, `decisionsFromAcpOptions`, `toAcpPermissionResponse`, `fromAcpPermissionResponse` and `fromAcpPermissionRequest` map to and from its `allow_once` / `allow_always` / `reject_once` / `reject_always` options. `allow-session` answers `allow_once`, and the session rule stays on the client. These are types and functions only, with nothing new to install.

  `onApprove` and `onDeny` work as before. When you pass `onDecide`, they are not called.

- [#34](https://github.com/dgesteves/signoff-ui/pull/34) [`39d503f`](https://github.com/dgesteves/signoff-ui/commit/39d503f0a1c9ed27e1de9c58eb06f61c4918560b) Thanks [@dgesteves](https://github.com/dgesteves)! - Approval cards claim only what you told them, and read better with a screen reader.

  - **`risk` has no default.** It used to default to `'medium'`, so every card, and every `ToolApprovalCard` for a tool without `risk` in its meta, said "Medium risk" when nobody had rated it. Without `risk`, the card now shows no risk badge, uses its neutral colors and has no `data-risk`.
  - **A neutral reason placeholder.** The denial reason field said "e.g. Use the existing Redis client instead", copy from the demo. It now says "What should the agent do instead?", and the new `reasonPlaceholder` prop sets your own.
  - **Not a landmark.** `ApprovalCard` is a group named by its title (`role="group"`), not a region landmark, so a run with many approvals no longer fills landmark navigation. Pass `role="region"` to make it one. Tests that find the card with `getByRole('region')` need `getByRole('group')`.
  - **"Approved" once.** A decided card read "Approved, Approved": the announcement stayed in the card next to the outcome. The announcement now clears 3 seconds after it is made.
  - **`ToolCallTimeline`.**
    - Calls that settle together, such as parallel calls, are announced in one message, after a 300 ms pause. Before, only the last one was announced.
    - Calls that had already settled when the timeline mounted are not announced.
    - The awaiting-approval "!" beside a call is hidden from screen readers; the call's button already says "Needs approval".

- [#50](https://github.com/dgesteves/signoff-ui/pull/50) [`34dfe90`](https://github.com/dgesteves/signoff-ui/commit/34dfe9014822a1202f4e23f4a0391536cec194ca) Thanks [@dgesteves](https://github.com/dgesteves)! - `DiffReview` stays responsive on large files. A 5,000-line rewrite used to block the page for 3.3 s, leave 260,000 elements and take 77 ms per keypress; it is now ready in under 0.3 s, with no task over 60 ms, about 4,000 elements and under 1 ms per keypress (Chrome, Apple M1 Max).

  - **A limit on the diff.** `maxEditLength` (default 2,000 lines added plus removed) caps the diff, whose cost grows with the square of that number. Past it, the changed region (from its first changed line to its last) is one hunk that replaces it, with no word-level highlights, and the review says so; `ParsedFileDiff.fallback` is `'replace'` and the file carries `data-fallback="replace"`. `parseFileChange` takes the same option, and `DEFAULT_MAX_EDIT_LENGTH` is exported from `signoff-ui/core`. The common lines before and after the change are set aside before diffing, so only the changed region counts, and lines only added or only removed never fall back.
  - **A worker.** A file that needs more than 300 edits is diffed in a worker and reads "Comparing changes…" until it is done; Apply and the bulk buttons wait for it. Webpack 5, Next.js (webpack and Turbopack) and Vite emit the package's worker as they build. The new `diffWorker` prop takes a function that starts your own `Worker`, or `false`; without a working worker, files are diffed on the main thread after the first paint. A server render diffs what a render may and shows the rest as being compared, so hydration matches.
  - **Only what is near the screen.** A review with more than 400 rows renders, of each hunk, the rows near the viewport; the rest keep their height and their lines as visually hidden text, so screen readers and find-in-page still have every line, read with "Added:" and "Removed:". Hunks always render, so focus, J and K and their names do not change, and a decision re-renders only the hunks it touches.

  Where two diffs are equally small, hunks can now differ from jsdiff's own: the region between the common first and last lines is what gets diffed. The edits are as few as before, and `applyHunks` gives the same files.

- [#53](https://github.com/dgesteves/signoff-ui/pull/53) [`4d23065`](https://github.com/dgesteves/signoff-ui/commit/4d2306565b9eb6521e3a90b04443a2eb58cf808c) Thanks [@dgesteves](https://github.com/dgesteves)! - Labels: every word the components show or announce can be replaced, so the kit can be translated whole.

  - **`SignoffLabelsProvider`** takes a translation of `defaultLabels`, whole or in part, for every component inside. Providers nest, the inner one winning key by key. Every component also takes a `labels` prop, which wins over the providers for it and what it renders. `useSignoffLabels()` returns the labels in effect, for markup of your own, and `mergeLabels()` builds them anywhere.
  - **207 labels in twelve sections**, 140 strings and 67 functions: visible text, accessible names, live-region announcements, keyboard hints, titles and placeholders. Text built from values (counts, paths, line numbers, tool names) is a function, so a translation gets plurals and word order right; `format` holds how durations, token counts, cost and percentages read. Type a translation as `SignoffLabels` and the compiler lists what it misses. The docs have a complete one in Portuguese.
  - `useDiffReview` and `useApprovalPolicy` take `labels` too, and `deriveAgentState` a `writingResponse` detail.
  - Each component bundles the English of the sections it reads only: 0.2 to 1.5 kB gzipped more per import, 2.4 kB for the whole main entry.

  Small changes that come with it:

  - `Sources` is now a client module, as it reads the labels. It still renders from a Server Component: its props are data.
  - The diff review's view toggle is named "Unified" and "Split", capitalized for screen readers too (before, only on screen).

- [#32](https://github.com/dgesteves/signoff-ui/pull/32) [`bf53438`](https://github.com/dgesteves/signoff-ui/commit/bf53438692bd14650ab8f18576e8355f8096d1c8) Thanks [@dgesteves](https://github.com/dgesteves)! - `useRunTiming` times each turn on its own. Pass the chat's messages, `useRunTiming(status, messages)`: a run then starts with each user message (or a regenerated reply) and spans its approval round trips. Without them, a run now starts with each request submitted after the last one ended. Before, every turn was added to the first: the second turn of a chat showed the first turn's time to first token and the sum of both turns' active time. Time to first token is also no longer 0 by mistake: for a run that was already streaming when the hook first saw it (keyed by a counter that changed while a stopped run was still settling, for example) it is unknown, and so, given the messages, for a request stopped before any reply arrived. The README quickstart now passes `messages`.

- [#37](https://github.com/dgesteves/signoff-ui/pull/37) [`c459d3f`](https://github.com/dgesteves/signoff-ui/commit/c459d3f61e00f76c8c3a69252da8d2bfd1597df9) Thanks [@dgesteves](https://github.com/dgesteves)! - **`@dgesteves/agent-ui-kit` is now `signoff-ui`.** This is its first release under the new name. The components, their props and their behavior are the same; the names around them changed, so they no longer collide with assistant-ui, which also uses `data-aui` and `--aui-`:

  - **Package:** `npm uninstall @dgesteves/agent-ui-kit && npm i signoff-ui`. The entry points keep their shape: `signoff-ui/core`, `signoff-ui/ag-ui`, `signoff-ui/styles.css`, `signoff-ui/tailwind.css` and the rest.
  - **CSS variables:** `--aui-*` is `--signoff-*` (`--signoff-bg`, `--signoff-accent`, `--signoff-radius` …).
  - **Tailwind:** the utilities and theme variables follow, `bg-aui-bg` to `bg-signoff-bg`, `rounded-aui` to `rounded-signoff`, `--color-aui-*` to `--color-signoff-*`, and the keyframes are `signoff-*`.
  - **Attributes:** component roots have `data-signoff` instead of `data-aui`, and every `data-slot` value starts with `signoff-` (`signoff-approval-card`, `signoff-diff-hunk` …).
  - **shadcn registry:** the namespace is `@signoff-ui`, and items install into `components/signoff-ui/`. The registry URLs on agent-ui-kit-demo.vercel.app are unchanged.

  One `perl` command renames the imports, variables, classes and attributes in your code; the [migration guide](https://agent-ui-kit-demo.vercel.app/docs/migrating-from-agent-ui-kit) has it, with the `data-slot` values and the steps for registry installs.

  **`styles.css` leaves your theme and your content alone.** It used to set Tailwind's theme variables (`--spacing`, `--text-*` …) on every component, and its utilities and reset applied to everything inside one. Your own content in `renderTool`, `renderData`, `renderOutput`, `renderExtra` or a custom approval `preview` was restyled with them: in a Tailwind v4 app whose theme sets `--spacing: .5rem`, its `p-4` measured 16px instead of 32px, and a `<p>` lost its margins. Now:

  - The stylesheet declares only the kit's `--signoff-*` tokens and Tailwind's per-element `--tw-*` properties. Tailwind's theme values are written into the utilities, which read the kit's `--signoff-*` tokens and none of your theme's variables.
  - Your content sits in an element with `data-signoff-slot`, and the stylesheet's rules stop there, so your own CSS styles it. Components you render in a slot are styled as usual, up to two levels deep.
  - Its keyframes are renamed `signoff-*`, so Tailwind's `pulse` no longer replaces one of your app's.
  - `JsonView` and `ToolCallDetails` have a `data-signoff` root, so they are styled when you render them on their own.

  With Tailwind v4 and `tailwind.css`, your build generates the utilities as before.

- [#51](https://github.com/dgesteves/signoff-ui/pull/51) [`515908a`](https://github.com/dgesteves/signoff-ui/commit/515908a3bd18d06aef8714b714f995f2fec39090) Thanks [@dgesteves](https://github.com/dgesteves)! - `DiffReview` now talks back: the reviewer comments on lines and hunks, decides whole files and marks them viewed, and the agent gets all of it.

  - **Line selection and comments.** Shift with the up or down arrow selects lines in the focused hunk; a click on a line number does too, and Shift-click extends it. C comments on the selected lines, or on the whole hunk when none are. ⌘/Ctrl+Enter saves the comment and Escape cancels. Comments are controlled with `comments`, `defaultComments` and `onCommentsChange`. Each comment has its file, its line range (`side`, `startLine`, `endLine`) and its text.
  - **A result the agent acts on.** `onSubmit` still gets each file with only the accepted hunks applied. Each file now also has its `decision` (`accepted`, `rejected`, `partial`, `pending` or `unchanged`), `status`, `viewed` and `oldPath`. The result adds `rejectedHunks`, with their lines, and `comments`, with the lines they are on. A second argument gives `toPatch()`: the accepted changes as a git-style unified diff. `reviewToolOutput(result)` shapes the result for the model as an AI SDK tool output: a summary sentence, counts, decisions, rejected hunks and comments, with contents or a patch. `reviewResumeEntry(interruptId, result)` is the same as an AG-UI resume entry. The quickstart now sends `reviewToolOutput(review)`.
  - **Files.** A multi-file review lists its files in a navigator: one tab stop, with the arrows, Home and End. Each file has Accept file and Reject file buttons, also on Alt+A and Alt+R, and a Viewed checkbox, also on V, which folds the file away (`collapseViewed`) and moves on. `viewed`, `defaultViewed` and `onViewedChange` control the marks, and Shift+J and Shift+K move between files.
  - **Renamed and binary files.** A renamed file shows its old path. Binary files (a NUL in the contents, a binary patch, or `binary: true`) read "Binary file, not shown". Renames without changes and files created or deleted empty are decided as a whole too, under the id `${path}:file`.
  - **Context.** Unchanged lines between hunks can be shown, 20 at a time or all at once, from the bar between hunks or with E.
  - **`useDiffReview`.** The review without its markup: state, keyboard, result and prop getters, for teams with their own design system. `DiffReview` is built on it, and it is a registry item of its own (`use-diff-review`).

  Behaviour that changes. A binary file, a rename without changes, or a file created or deleted empty used to show "No textual changes." with nothing to decide. Each now counts as one decision in the totals, in Apply's label and in the result's `pending` until decided. Items are named "Change 5 of 6, …" for whole files and "Hunk 2 of 6, …" for hunks. Contents with a NUL character are no longer diffed as text.

- [#33](https://github.com/dgesteves/signoff-ui/pull/33) [`c28f668`](https://github.com/dgesteves/signoff-ui/commit/c28f6686a0050e987df67a3a3043beb1ed01d5cf) Thanks [@dgesteves](https://github.com/dgesteves)! - A stopped run no longer reads "Done". `deriveAgentState` returns a new `stopped` state when the run has ended (`ready`) with work unfinished in the message, which is what `stop()` leaves behind: text or reasoning still streaming, or a tool call still preparing, running or with partial output. `AgentStatus` shows it as "Stopped" with a stop glyph, and announces it politely. `AgentMessage` with `active={false}` also ends text and reasoning that were left streaming, so a stopped answer loses its caret and its "Thinking" label.

  AG-UI runs end the same way. A `RUN_FINISHED` with a `cancelled` outcome, `useAgUiAgent`'s `stop()`, and `HttpAgent`'s own abort leave what was streaming cut off, so they read as `stopped`. Before, a cancelled run read as finished, and stopping an `HttpAgent` run showed an error ("Aborted"), because `HttpAgent` reports its abort as `RUN_ERROR` with code `abort`.

  If you derive `active` as the README did, `active={state !== 'done' && state !== 'error'}`, add `state !== 'stopped'`. Without it, calls a stopped run cut off keep their clocks running. Client-side tools the app runs itself (`onToolCall`, then `addToolOutput` and `sendAutomaticallyWhen`) go in the new `clientTools` option. `useChat` is `ready` while one runs, and the call is `input-available`: with its name in `clientTools`, the run reads `working` with the tool as its detail, instead of flashing `stopped` until the output lands. `pendingClientTools` is unchanged; it is for client-side tools that wait on a person, which read `awaiting-approval`.

## 0.4.3

### Patch Changes

- [#30](https://github.com/dgesteves/agent-ui-kit/pull/30) [`f8dae5e`](https://github.com/dgesteves/agent-ui-kit/commit/f8dae5e591c92ded6f93c1f7afdef53c73fc2d50) Thanks [@dgesteves](https://github.com/dgesteves)! - The README opens with the demo, on GitHub as a video and on npm animated.

## 0.4.2

### Patch Changes

- [#28](https://github.com/dgesteves/agent-ui-kit/pull/28) [`13f7fec`](https://github.com/dgesteves/agent-ui-kit/commit/13f7fec472fdc01d234b15222bd4b67075a96dc3) Thanks [@dgesteves](https://github.com/dgesteves)! - The npm page now shows the repository's README, the same one as on GitHub (every component with its screenshot, AG-UI, theming and the full quickstart), instead of a shorter separate README.

## 0.4.1

### Patch Changes

- [#19](https://github.com/dgesteves/agent-ui-kit/pull/19) [`afc5071`](https://github.com/dgesteves/agent-ui-kit/commit/afc507189fd2f54b77440003e702f8348bba6347) Thanks [@dgesteves](https://github.com/dgesteves)! - Content that scrolls sideways is now reachable from the keyboard: a diff hunk's code, a code block or table in `Markdown`, an approval card's command preview and the compact `RunMeter` strip. While their content is wider than they are, they join the tab order as named groups ("Hunk 2 code, app/api/chat/route.ts", "Code, ts"), so the arrow keys scroll them, with a visible focus ring; once everything fits, they add no tab stop. Fixes axe's `scrollable-region-focusable` (WCAG 2.1.1).

- [#18](https://github.com/dgesteves/agent-ui-kit/pull/18) [`b3e4361`](https://github.com/dgesteves/agent-ui-kit/commit/b3e4361a3118199e8fc04faefe6b5aabb8953f74) Thanks [@dgesteves](https://github.com/dgesteves)! - `ToolCallTimeline` fits narrow columns: a long tool label truncates instead of pushing the row wider than its container, and the waterfall bar shows from a 24rem-wide timeline rather than from a 640px-wide screen, so a timeline in a sidebar or a phone-width panel no longer scrolls sideways.

## 0.4.0

### Minor Changes

- [#8](https://github.com/dgesteves/agent-ui-kit/pull/8) [`a83059d`](https://github.com/dgesteves/agent-ui-kit/commit/a83059d2416cfba5f61e3f705010456708d883f9) Thanks [@dgesteves](https://github.com/dgesteves)! - Follow the OS color scheme with `@dgesteves/agent-ui-kit/theme.auto.css`, imported after `styles.css`, `tailwind.css` or `theme.css`: the dark palette applies while the OS is in dark mode, unless `.light` or `data-theme="light"` is on `<html>`. `.light` now switches a subtree back to the light palette, as `data-theme="light"` did. The components also use the app's own `--font-sans` and `--font-mono` when it defines them, as shadcn/ui and Tailwind v4 apps do, before falling back to Geist and the system fonts.

- [#8](https://github.com/dgesteves/agent-ui-kit/pull/8) [`dee0c9f`](https://github.com/dgesteves/agent-ui-kit/commit/dee0c9fdf7d8cd5670697f962e25298590f11490) Thanks [@dgesteves](https://github.com/dgesteves)! - Support React 18.2 and later: the peer range is now `^18.2.0 || ^19.0.0` for `react` and `react-dom`. `Markdown`, and with it `AgentMessage` and `Reasoning`, rendered its image policy through React 19's `<Context value>`, which crashed on React 18; it now uses `<Context.Provider>`. CI runs the typecheck and the test suite on React 18 too.

### Patch Changes

- [#9](https://github.com/dgesteves/agent-ui-kit/pull/9) [`d331de8`](https://github.com/dgesteves/agent-ui-kit/commit/d331de8915c074a02f647c90565bdb750dfa696e) Thanks [@dgesteves](https://github.com/dgesteves)! - The package description and README now say what the kit works with, AI SDK 6 & 7 and AG-UI, instead of "typed against AI SDK v7", and the npm homepage links to the live playground.

- [#8](https://github.com/dgesteves/agent-ui-kit/pull/8) [`ee98aef`](https://github.com/dgesteves/agent-ui-kit/commit/ee98aef383dd2947f4b9056a65cec519459fca48) Thanks [@dgesteves](https://github.com/dgesteves)! - The type declarations no longer end in `sourceMappingURL` comments pointing to `.d.ts.map` files that the package does not ship.

- [#7](https://github.com/dgesteves/agent-ui-kit/pull/7) [`7bd4242`](https://github.com/dgesteves/agent-ui-kit/commit/7bd424288fc2b140019802b1f877a78371fc7fc4) Thanks [@dgesteves](https://github.com/dgesteves)! - Pages that render the components now build with Next.js 16 `cacheComponents`, the default in new apps. `AgentStatus`, `ToolCallTimeline`, `AgentMessage` and `useRunTiming` no longer read the clock while rendering on the server, and `DiffReview` and `parseFileChange` keep jsdiff from reading it, so `next build` no longer fails with "Next.js encountered the unstable value `Date.now()`".

- [#8](https://github.com/dgesteves/agent-ui-kit/pull/8) [`427dd06`](https://github.com/dgesteves/agent-ui-kit/commit/427dd06e439cbd251e906a8e1c73f171bcc27132) Thanks [@dgesteves](https://github.com/dgesteves)! - Depend on `@radix-ui/react-collapsible` and `@radix-ui/react-toggle-group`, the two Radix primitives the components use, instead of the `radix-ui` package, which installed about 60 Radix packages (18 now). The shadcn registry items list the same two packages.

- [#8](https://github.com/dgesteves/agent-ui-kit/pull/8) [`9078703`](https://github.com/dgesteves/agent-ui-kit/commit/9078703647db7ebbff4de6d4c1a3e34f451989f5) Thanks [@dgesteves](https://github.com/dgesteves)! - The shadcn registry items lint clean under a new Next.js app's ESLint config, so apps that run `next lint`/`eslint --max-warnings=0` pass after `shadcn add`: no unused `_node` bindings in `markdown.tsx`, no `jsx-a11y` disable comments that such configs report as unused, and no `@next/next/no-img-element` warnings for the images in messages.

- [#8](https://github.com/dgesteves/agent-ui-kit/pull/8) [`5fe8f6e`](https://github.com/dgesteves/agent-ui-kit/commit/5fe8f6e757387f41b8dae59ac49103913106e889) Thanks [@dgesteves](https://github.com/dgesteves)! - `styles.css` works in Tailwind v3 apps and next to global resets. It no longer wraps its rules in `@layer`, which Tailwind v3 builds rejected ("`@layer base` is used but no matching `@tailwind base` directive is present") and which let any unlayered reset, such as create-next-app's `* { padding: 0; margin: 0 }`, strip the components' spacing. Its rules, Tailwind's theme variables included, now apply only to the kit's own elements, so it cannot restyle the app or override the app's Tailwind theme. The layered stylesheet is still available as `styles.layered.css`, and the components' line height no longer depends on the page's.

## 0.3.0

### Minor Changes

- [#5](https://github.com/dgesteves/agent-ui-kit/pull/5) [`28c9b64`](https://github.com/dgesteves/agent-ui-kit/commit/28c9b64e278ede6bda742443a28368bec901dd45) Thanks [@dgesteves](https://github.com/dgesteves)! - Render AG-UI agents (LangGraph, CrewAI, Mastra, Pydantic AI and other AG-UI integrations) with the same components. `useAgUiAgent(agent)` from the new `@dgesteves/agent-ui-kit/ag-ui` entry takes an `@ag-ui/client` agent and returns its messages as AI SDK parts, plus `status`, `usage`, `step` and open `interrupts`. Tool-call interrupts become approval cards: pass `respond` as `AgentMessage`'s `onToolApproval`, and the run resumes once every open interrupt has an answer. The pure `fromAgUiMessages`, `reduceAgUiRun`, `answerAgUiInterrupt` and `getAgUiResume` work with any store. Also available as the `ag-ui` shadcn registry item.

## 0.2.0

### Minor Changes

- [#2](https://github.com/dgesteves/agent-ui-kit/pull/2) [`bc48aed`](https://github.com/dgesteves/agent-ui-kit/commit/bc48aeda21fe85f3b033a69741aed61a2c376d59) Thanks [@dgesteves](https://github.com/dgesteves)! - Support AI SDK 6. The `ai` peer range is now `^6.0.0 || ^7.0.102`, and CI runs the typecheck and the full test suite against AI SDK 6.0.0 and the latest 6.x as well as 7. The kit reads the two approval fields AI SDK 7 added (`approval.isAutomatic` for `toolApproval` policy decisions, and `approval.requestReason`) only when they are present, so on AI SDK 6 approvals are always a person's decision and the card falls back to your `description`. Policies, and the "Auto-approved" and "Blocked by policy" labels, remain AI SDK 7 features.
