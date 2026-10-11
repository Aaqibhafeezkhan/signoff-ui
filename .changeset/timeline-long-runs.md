---
'signoff-ui': minor
---

`ToolCallTimeline` keeps up with very long runs. At 2,000 calls, appending one took about 105 ms of the main thread until its frame was painted; it now takes about 2.5 ms (12 ms with the CPU six times slower). With a call running, frames dropped to about 50 ms; they now keep the display's pace. The first render goes from about 440 ms to 40 ms.

- **A long run renders only the calls near the screen.** Past 150 calls, the timeline renders the calls within 800 px of the viewport, in chunks of 25. A chunk away from it is an empty item as tall as its calls, hidden from assistive tech. A chunk holding an open call, a call still going (running, streaming its input or waiting on approval) or focus stays rendered. The calls that render carry `aria-posinset` and `aria-setsize`. Arrow Up and Down, Home and End move between all the calls, scrolling a call that isn't rendered into view and focusing it. Announcements are unchanged. What a call far from the screen renders, including `renderExtra`'s content, unmounts until it comes back near. Shorter timelines render every call, as before.
- **Only the calls that change render again.** A new call, or a running call's clock, no longer renders every call. The waterfall's bars are placed from each call's times and the timeline's span, set on the bars that are rendered.
- **The enter animation leaves nothing behind.** `--animate-signoff-enter` fills `backwards`, not `both`: the end state is the same, but a finished animation no longer stays in effect on every element it ran on. A call that renders again as its chunk comes back near the screen doesn't slide in.
