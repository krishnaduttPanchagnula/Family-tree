# v0.4.0 task list

Legend: `[ ]` todo · `[x]` done · `[~]` in progress

## Foundation

- [x] Capability map reviewed; decisions: full sources table, one v0.4.0,
      destructive modules ship with confirm + snapshot.
- [x] Module conventions + 15 specs written.
- [x] Tools launcher (`feat-tools`) and central hooks in `app.js`
      (person panel, search filter, visible persons, connector width/colour).

## Wave 1 — parallel

- [ ] `sources` — table, CRUD API, person tab
- [ ] `person-merge` — snapshot-first merge, fields preview, confirm by name
- [ ] `photo-manager` — scan uploads, usage, traversal-safe delete
- [ ] `search-filters` — status/photo/decade/generation, persisted
- [ ] `worksheet` — printable blank tree
- [ ] `household-view` — partner + children blocks, undoable
- [ ] `multi-tree` — named family lines in columns, undoable
- [ ] `export-wipe` — snapshot, typed confirm, optional photo delete
- [ ] Integrate wave 1 (routes, tags, `make check`, curl smoke, commit)

## Wave 2 — parallel

- [ ] `tree-health` — findings engine + panel, merge action
- [ ] `calendar` — birthdays/anniversaries/on-this-day
- [ ] `event-media` — files on events
- [ ] `chart-options` — thickness, monochrome, generation limit
- [ ] `timeline-range` — range presets + generation grouping
- [ ] Integrate wave 2

## Wave 3 — parallel

- [ ] `reports` — ancestor/descendant/missing/sources, printable
- [ ] `duplicate-import` — detect, skip, override
- [ ] Integrate wave 3

## Release

- [ ] Full `make check`, JS syntax pass, seeded-tree smoke test
- [ ] `CHANGELOG.md` `## v0.4.0` with every feature
- [ ] `README.md` updated (tools, endpoints, limitations)
- [ ] Commit, tag `v0.4.0`, push, watch the release workflow
- [ ] Verify assets + release notes
