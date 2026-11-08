# Named-study trial rollback

Previous published version: **101**
Version ID: `appgprj_6aa188c94ff88191b75dbddc48fb54e3~appgver_107ed63e229881919c979f5cb7f86f47`
Source commit: `3df73ef8ba245f6e33c4307fb8081a304cce40ab`
Site: `appgprj_6aa188c94ff88191b75dbddc48fb54e3`

For an immediate complete rollback, deploy the saved version above with Sites.
For a rollback of explicit saves only, redeploy version 104:
`appgprj_6aa188c94ff88191b75dbddc48fb54e3~appgver_06d504e051688191972c8bb89f70bdb9`.
Use a saved-version rollback rather than disabling the source flag: saved
snapshots are now protected against the current autosave code.

No database version upgrade or destructive migration is used. The original
workspace remains at `current`, and its Model knowledge workspace remains at
`model-knowledge-v1`. These are the same keys version 101 reads and writes.
The study list is a separate `named-studies-v1` record; additional studies use
`study:<id>:texts` and `study:<id>:knowledge`. API keys are never included.

Rolling back opens the original workspace. Named studies become hidden, not
deleted, and return when the feature is re-enabled in the same browser.
Do not clear IndexedDB, delete study records, or copy a named study over the
original during rollback. Students should export any needed results before a
planned rollback. Session selection is only a convenience and is ignored while
the feature is disabled.

Deletion is explicit and permanent: it replaces the deleted workspace with a small tombstone to prevent late saves from other tabs. Rollback cannot recover studies the user chose to delete. The catalog may no longer contain the original study after deletion.

## Explicit-save working copy

The working copy uses `study:working-copy-v2:texts` and
`study:working-copy-v2:knowledge`, plus `working-copy-meta-v2`. Previous study
records remain at their original keys and become saved return points. Loading
copies them into the working copy. Only an explicit save updates those records.
Initialization never replaces an existing working copy. Snapshot writes include
revision guards and a snapshot marker to reject accidental autosaves.

Before reverting to version 104, deliberately save the working copy. That version
will display the saved studies using its earlier automatic-update behavior.
The separate working copy remains stored but is hidden until re-enabled.
Deleted or explicitly overwritten snapshots cannot be restored by rollback.
