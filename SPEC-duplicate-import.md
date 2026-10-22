# Spec: Duplicate detection on GEDCOM import (`duplicate-import`)

## Objective

A second GEDCOM import is how most duplicates get in. Detect people who already
exist, skip them by default, and let the user override per import. This module
owns `gedcom.go` and `web/feat-data.js` in this wave.

## Behaviour

Before inserting, compare every parsed individual with the existing people:

- Normalise names: lower-case, collapse whitespace, ignore a trailing
  generation suffix (`Jr`, `Sr`, `II`).
- A duplicate is:
  - same normalised name **and** same non-empty `dob` (exact string after
    trimming), or
  - same normalised name **and** the same four-digit birth year when one side
    has a full date and the other only a year, or
  - same normalised name and both `dob`s empty **and** the same birth place —
    this last case is reported as a warning, not skipped by default.
- Return, in the import response:

```json
{
  "imported": 12, "skipped": 2,
  "duplicates": [{
    "gedcom_id": "@I12@", "name": "Ada Lovelace", "dob": "1815-12-10",
    "existing_id": 4, "existing_name": "Ada Lovelace",
    "reason": "same name and birth date", "severity": "duplicate"
  }]
}
```

- Default: skip `severity:"duplicate"` rows; import `severity:"warning"` rows
  (they are only reported). The request may set `allow_duplicates=true` (JSON
  field or query param) to import everything.
- Never skip a person who is not a duplicate. Never merge automatically.
- The count of imported/skipped must match the rows actually inserted.
- The import stays additive and keeps the existing relationship/event
  behaviour and date conversion.

## UI

`web/feat-data.js` already owns the import flow. After an import:

- If `duplicates` is non-empty, show a dialog listing them (name, dates,
  "already in the tree as …", reason) with the count of skipped people.
- Buttons: **Keep the tree as it is** (close) and **Import these anyway**
  (re-posts the same file with `allow_duplicates:true`; the file must be kept
  in memory or re-selected). If the file object is no longer available, offer
  "Choose the file again" instead of silently doing nothing.
- If nothing was skipped, keep the existing success toast and add "N people
  already existed".
- Escape every name; read the list with a screen reader (a real list, not a
  blob of text).

## Tests

- Same name + same dob → duplicate, skipped by default.
- Same name + different dob → imported.
- Same name + one year-only dob matching the other's year → duplicate.
- `allow_duplicates=true` imports the duplicate and reports it.
- No existing people → nothing reported.
- The skipped count equals the number of duplicate rows.
- Existing GEDCOM round-trip tests still pass.

## Out of scope

Merging during import (use `person-merge` afterwards), fuzzy name matching,
previewing before the first insert.
