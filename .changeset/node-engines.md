---
'signoff-ui': minor
---

`engines` names the Node versions the package runs on: Node 20.19 or later on 20, 22.12 or later on 22, and any later major (`^20.19.0 || >=22.12.0`). The package is ESM only, and these are the versions that load an ES module from `require()` without a flag; Node 22.0 to 22.11 throw `ERR_REQUIRE_ESM` there. Node 18, 21 and 22 before 22.12 are no longer supported: Yarn 1, and npm or pnpm with `engine-strict`, refuse to install the package on them.
