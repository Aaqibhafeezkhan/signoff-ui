---
'signoff-ui': patch
---

`RunMeter` no longer shows a negative number for a moment as a value animates, such as "↑ -89" or "$-0.0002" at the start of a run. A frame that began before the animation counts as its start.
