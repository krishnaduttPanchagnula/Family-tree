# Spec: Check my tree (`tree-health`)

## Objective

Gramps ships a data-quality analysis; WikiTree treats a missing source as a
problem. Give the local user a plain-language list of what is wrong or
incomplete in their tree, and a route to fix the worst of it.

## API

`GET /api/tree-health`

```json
{
  "generated": "2026-10-22T18:00:00Z",
  "summary": {"people": 24, "findings": 7, "issues": 19,
              "by_severity": {"error": 1, "warning": 3, "notice": 3}},
  "findings": [{
    "id": "duplicate-12-31",
    "category": "duplicate",
    "severity": "error",              // error|warning|notice
    "title": "Two people look like the same person",
    "detail": "Ada Lovelace (1815-12-10) appears twice.",
    "person_ids": [12, 31],
    "action": "merge"                 // merge|open|none
  }]
}
```

Checks, each a finding with every matching person:

| category | severity | rule |
|---|---|---|
| `duplicate` | error | same normalised full name and same non-empty `dob` |
| `date-order` | error | both dates parse as `YYYY-MM-DD` (or `YYYY-MM`) and `dob > dod` |
| `future-date` | warning | `dob` or `dod` parses and is after today |
| `unlinked` | warning | no relationships at all |
| `disconnected` | warning | not in the largest connected component (skip when there is one component) |
| `missing-dates` | notice | empty `dob` and empty `dod` |
| `missing-photo` | notice | empty `image_url` |
| `missing-birth-place` | notice | empty `birth_country` |

Normalise names: lower-case, collapse whitespace. Parse dates leniently;
unparseable dates never trigger a date finding. One finding per rule, with
`person_ids` listing everyone affected (cap the detail sentence at three names
+ "and N others"). Sort by severity then category. No people → zero findings.

Expose `computeTreeHealth() (treeHealthReport, error)` for the reports module.
The endpoint wraps it.

## UI

Tools launcher entry **Check my tree** (`i-check`).

- Summary tiles: people, errors, warnings, notices.
- Findings grouped by severity, each with title, detail, and person buttons
  that close the dialog and call `jumpToPerson(id)`. For `action:"merge"`,
  also a **Merge these** button that calls `window.openMergeDialog(a, b)` when
  available, otherwise a hint to open one of the people and use Merge.
- Empty state: "Nothing to fix. Every person has dates, a photo, a place and a
  connection." with a check icon.
- A "Recheck" button re-fetches. The dialog is read-only for the shared view
  (Merge hidden).
- Focus the first person button; the list scrolls; no nested dialogs.

## Tests

- Empty tree → zero findings.
- Seed two identical names and dates → one `duplicate` finding with both ids.
- `dob > dod` → `date-order`; a future date → `future-date`.
- An unlinked person and a two-person island in a larger tree → `unlinked` and
  `disconnected` respectively, with the big component not reported.
- Unparseable dates do not produce a date finding.
- Summary counts add up.

## Out of scope

Fixing automatically (merge is a separate module), source coverage in this
report, scanning photo files on disk.
