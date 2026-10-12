---
'signoff-ui': patch
---

`useApprovalPolicy`: an `always` rule from `defaultRules` that a person removes now stays removed after a reload, instead of coming back on every load. A default your app adds in a later version still appears. `webStorageRules()` keeps the removed ids under `<key>:removed-defaults` and `memoryRuleStorage()` keeps them in memory; a storage of your own can keep them with the new optional `loadRemovedDefaults()` and `saveRemovedDefaults(ids)`. Rules saved by earlier versions load as before.
