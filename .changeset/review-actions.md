---
'signoff-ui': minor
---

`DiffReview` takes an `actions` prop: your own controls, such as a "Copy as a patch" button, in its header next to the layout toggle. They sit in a `data-signoff-slot` element, so `styles.css` leaves them to your CSS, and keys pressed on them don't trigger the review's shortcuts.
