# Plan: v0.4 local-first feature batch

Source of truth: `CAPABILITY-MAP.md` + `SPEC-<id>.md` + `SPEC-CONVENTIONS.md`.
One release, `v0.4.0`, after all three waves.

## Parallelisation model

Each module is implemented in its own git worktree by one agent, from the
current `main`. Agents commit only their owned files; integration (routes,
script tags, CHANGELOG, README) happens on `main` after each wave. This keeps
`go test ./...` meaningful in every worktree and makes merges conflict-free.

## Waves

### Wave 1 — no module depends on another

| Module | Owned files | Integration on main |
|---|---|---|
| `sources` | `sources.go`, `sources_test.go`, `web/feat-sources.*` | `initSources`, `registerSources`, script+link |
| `person-merge` | `person_merge.go`, `person_merge_test.go`, `web/feat-person-merge.*` | route, script+link |
| `photo-manager` | `photo_manager.go`, `photo_manager_test.go`, `web/feat-photo-manager.*` | `initPhotoManager` (none), `registerPhotoManager`, script+link |
| `search-filters` | `web/feat-search-filters.*` | script+link |
| `worksheet` | `web/feat-worksheet.*` | script+link |
| `household-view` | `web/feat-household-view.*` | script+link |
| `multi-tree` | `web/feat-multi-tree.*` | script+link |
| `export-wipe` | `export_wipe.go`, `export_wipe_test.go`, `web/feat-export-wipe.*` | route, script+link |

### Wave 2 — depends on shipped modules or wave 1

| Module | Depends on | Owned files | Integration |
|---|---|---|---|
| `tree-health` | `person-merge` (UI only) | `tree_health.go`, `tree_health_test.go`, `web/feat-tree-health.*` | route, script+link |
| `calendar` | `events` (shipped tables) | `calendar.go`, `calendar_test.go`, `web/feat-calendar.*` | route, script+link |
| `event-media` | `events` (shipped) | `event_media.go`, `event_media_test.go`, `web/feat-event-media.*` | route, script+link |
| `chart-options` | `feat-styles` (shipped) | `web/feat-styles.js`, `web/feat-styles.css` | none (already loaded) |
| `timeline-range` | `feat-timeline` (shipped) | `web/feat-timeline.js`, `web/feat-timeline.css` | none (already loaded) |

### Wave 3 — consumes wave 1/2 output

| Module | Depends on | Owned files | Integration |
|---|---|---|---|
| `reports` | `tree-health`, `sources` | `reports.go`, `reports_test.go`, `web/feat-reports.*` | route, script+link |
| `duplicate-import` | `person-merge` (follow-up path only) | `gedcom.go`, `web/feat-data.js` | none (already loaded) |

## Integration checklist per wave

1. Merge each worktree branch into `main` (owned files only; no conflicts
   expected).
2. Wire `init*`/`register*` calls and routes in `main.go`.
3. Add `<link>` and `<script>` tags in `index.html`.
4. `make check` (gofmt, vet, all tests) green.
5. Run the app on a spare port with a copy of the database; curl every new
   endpoint (happy path + one rejection).
6. `node --check` every changed JS file.
7. Commit the wave with one message per module or one per wave.

## Release (after wave 3)

1. Full `make check`; run `goreleaser build --snapshot --clean` locally.
2. Update `CHANGELOG.md` with a `## v0.4.0` section listing every feature.
3. Update `README.md`: new tools, endpoints, and the "what it does not do"
   list (remove shipped limitations).
4. Commit, tag `v0.4.0` (unsigned, matching the existing pipeline), push tag.
5. Watch the release workflow, verify assets and the notes body.

## Risks

- **Shared-file drift** — agents must not edit central files; integration
  re-checks `git status` after every wave.
- **Destructive modules** — merge and wipe are snapshot-first and confirm-
  gated; tests cover the refusal paths.
- **Large tree performance** — health, reports and calendar are linear scans;
  photo manager scans only one directory. No new indexes needed at this scale.
- **JS-only modules** have no unit tests; they get a syntax check plus a manual
  smoke test on a seeded tree before the release.
