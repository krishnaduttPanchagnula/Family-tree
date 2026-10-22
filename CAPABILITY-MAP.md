# Capability Map: Local-first family tree v0.4

> Status: **approved.** Decisions: full citations table for `sources`, one
> `v0.4.0` release at the end, destructive modules ship with confirmation and
> a snapshot. Module specs: `SPEC-<module-id>.md`. Technical contract:
> `SPEC-CONVENTIONS.md`.
>
> Source: `competitor-research.md` §3 (underserved angles) and the benchmark
> matrix. Every module below traces to a finding in that document.

## Scope check

Fifteen independently testable capabilities came out of the research. They
separate cleanly into four concerns — **evidence** (what backs a fact),
**quality** (is the tree right), **documents** (getting it out of the app) and
**shape** (how the chart is drawn). Each can ship and be verified on its own,
so each gets its own spec.

## Capability map

| Module id | Responsibility | Depends on | Notes / risk |
|---|---|---|---|
| `sources` | Sources & citations per person, and per event: type (census, certificate, photo, memory, story), citation text, date, notes | — | **Schema change** (`sources` table). WikiTree's core idea: a fact without a source is a rumour. |
| `event-media` | Attach a photo or document to a *life event*, not just to a person | `events` (shipped) | Geni attaches media to events. Needs a file table or a reuse of the event row. |
| `person-merge` | Merge two people into one: pick the survivor, choose which field wins, move photos/links/events/sources | — | **Destructive.** Needs a confirmation and a snapshot. |
| `tree-health` | The "Check my tree" panel: missing dates, missing photos, unlinked people, disconnected branches, same-name-same-birthday duplicates, events on nobody | `person-merge` | Gramps' data-quality analysis. The duplicate finding offers "Merge these". |
| `reports` | Printable documents: ancestor report, descendant report, missing-information report, sources report | `tree-health`, `sources` (optional content) | Gramps' reports. Text pages, not charts. |
| `calendar` | "This month in the family": upcoming birthdays and anniversaries, plus "on this day" | `events` (shipped) | FamilyEcho's Calendar tab, Geni's birthdays. Cheap, high delight. |
| `photo-manager` | List every file in `uploads/`, show which person uses it, flag orphans, delete unused files | — | The server deliberately leaves orphaned photos behind today. **Destructive** when deleting. |
| `search-filters` | Filter the search by generation, living/deceased, has-a-photo, and a date range | — | FamilyEcho's filters. Today one text string, eight hits, no filters. |
| `chart-options` | Generation limits (N up / N down from a chosen person), line thickness, line colour per relation | `styles`, `print` (shipped) | FamilyEcho's "1 gen … 50 gens" and line options. Extends the existing styles panel. |
| `worksheet` | A printable **blank** family tree sheet (A4/Letter, with and without a photo box) for a school project or a reunion activity | — | Treemily's "Tree Template for Kids", Creately's school-project intent. Needs no data. |
| `household-view` | A layout mode that groups a person with their partner and their children as one household | — | FamilyEcho's nuclear-family grouping. The data model already allows two spouses and two sets of children; the layout does not show it. |
| `multi-tree` | Several family lines on one canvas (e.g. maternal and paternal side by side) | — | Treemily's *Forrest Tool*. |
| `export-wipe` | One action: write a full backup, then empty the tree, for a clean restart or a handover | `backup` (shipped) | **Destructive.** Trust feature (§3.4). |
| `timeline-range` | The family timeline gains a range filter and per-generation grouping | `timeline` (shipped) | Small follow-on to the shipped timeline. |
| `duplicate-import` | On GEDCOM import, detect likely duplicates and let the user merge or skip | `gedcom` (shipped), `person-merge` | Gramps' duplicate detection, applied at the import boundary. |

Fifteen modules, two internal dependency edges, and nothing that points
backwards. Everything else runs in parallel.

## Build order (waves)

```
Wave 1  sources   person-merge   photo-manager   search-filters
        worksheet   household-view   multi-tree   export-wipe

Wave 2  tree-health (needs person-merge)   event-media (needs events)
        calendar (needs events)   chart-options (needs styles+print)
        timeline-range (needs timeline)

Wave 3  reports (needs tree-health, sources)   duplicate-import (needs person-merge)
```

**Wave 1 — eight modules, fully parallel.** No new module depends on another.
The Go side is one schema migration (`sources`) plus merge endpoints.

**Wave 2 — five modules, parallel.** The only new cross-module edge is
`tree-health → person-merge`, and `person-merge` landed in wave 1.

**Wave 3 — two modules, parallel.** Both consume wave 1/2 output.

Integration, browser verification and the `v0.4.0` release follow wave 3.

## Conventions this map inherits

- Go backend, SQLite, no build step for the frontend. Each module is a
  `web/feat-<id>.js` + `web/feat-<id>.css` pair loaded from `index.html`.
- Tests are Go tests next to the code (`main_test.go`, `features_test.go`);
  the frontend contract is checked by the existing asset-contract test.
- `make check` (format + vet + test) must be green before any commit.
- Each module's spec is saved as `SPEC-<module-id>.md` at the project root,
  next to this map.

## Boundaries that apply to every module in this map

- **Always:** keep `make check` green; add a Go test for every new endpoint;
  no emoji or ad-hoc glyphs as icons; text contrast ≥ 4.5:1; no request leaves
  the machine unless the user asked for it.
- **Ask first:** schema changes beyond the `sources` table; anything that
  deletes or rewrites existing data (merge, wipe, photo deletion).
- **Never:** break the read-only share guard; send family data anywhere; add a
  runtime dependency without asking.
