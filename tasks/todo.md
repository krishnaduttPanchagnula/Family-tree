# v0.4.0 task list

Legend: `[ ]` todo · `[x]` done · `[~]` in progress

## Foundation

- [x] Capability map reviewed; decisions: full sources table, one v0.4.0,
      destructive modules ship with confirm + snapshot.
- [x] Module conventions + 15 specs written.
- [x] Tools launcher (`feat-tools`) and central hooks in `app.js`
      (person panel, search filter, visible persons, connector width/colour).
- [x] `feat-common` helpers shared by the modules.

## Wave 1

- [x] `sources` — table, CRUD API, person tab
- [x] `person-merge` — snapshot-first merge, fields preview, confirm by name
- [x] `photo-manager` — scan uploads, usage, traversal-safe delete
- [x] `search-filters` — status/photo/decade/generation, persisted
- [x] `worksheet` — printable blank tree
- [x] `household-view` — partner + children blocks, undoable
- [x] `multi-tree` — named family lines in columns, undoable
- [x] `export-wipe` — snapshot, typed confirm, optional photo delete
- [x] Integrate wave 1 (routes, tags, `make check`, curl smoke, commit)

## Wave 2

- [x] `tree-health` — findings engine + panel, merge action
- [x] `calendar` — birthdays/anniversaries/on-this-day
- [x] `event-media` — files on events
- [x] `chart-options` — thickness, monochrome, generation limit
- [x] `timeline-range` — range presets + generation grouping
- [x] Integrate wave 2

## Wave 3

- [x] `reports` — ancestor/descendant/missing/sources, printable
- [x] `duplicate-import` — detect, skip, override
- [x] Integrate wave 3

## Release

- [x] Full `make check`, JS syntax pass, seeded-tree smoke test
- [x] `CHANGELOG.md` `## v0.4.0` with every feature
- [x] `README.md` updated (tools, endpoints, limitations)
- [x] Commit, tag `v0.4.0`, push, watch the release workflow
- [x] Verify assets + release notes
