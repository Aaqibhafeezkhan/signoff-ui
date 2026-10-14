---
'signoff-ui': patch
---

The optional `@assistant-ui/react` peer dependency takes any 0.x version from 0.15.0 on (`>=0.15.0 <1`), not only 0.15.x. npm checks an optional peer's range whenever the app has the package, so `npm i signoff-ui` failed with ERESOLVE in an app on another assistant-ui minor, 0.16 included once it ships, even one that never imports `signoff-ui/assistant-ui`. The binding imports only assistant-ui's types, and needs 0.15 or later.
