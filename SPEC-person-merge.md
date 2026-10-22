# Spec: Merge two people (`person-merge`)

## Objective

Duplicates happen: a GEDCOM import, a quick add, a relative typed twice.
Merging is the repair. Destructive, so it is explicit, previewed and preceded
by a snapshot.

## API

`POST /api/persons/merge`

```json
{
  "survivor_id": 12,
  "other_id": 31,
  "fields": { "name": "Ada Lovelace", "dob": "1815-12-10" }
}
```

`fields` is optional. For each of `name, dob, dod, birth_country, profession,
facts, image_url`:

1. an explicit value in `fields` wins (trimmed; empty string is allowed and
   means "leave empty");
2. otherwise the survivor's non-empty value wins;
3. otherwise the other person's value is taken.

Response: `{survivor: Person, moved:{relationships, events, sources},
dropped:{relationships}, snapshot:"name"}`.

## Rules

- Both ids must exist and differ; otherwise 400/404.
- Run in one transaction. Call `writeSnapshot()` first and abort if it fails.
- Relationships: repoint `person1_id`/`person2_id` from the other to the
  survivor. Drop a row that would become a self-link. Drop an exact duplicate
  of an existing survivor relationship (`other endpoint + relation`). Drop
  both directions of a spouse duplicate.
- Events: repoint `person_id`; drop an exact duplicate of an existing event
  (same kind, date, place, title, note).
- Sources: repoint `person_id`. Event ids stay valid because events moved.
- `event_media`: repoint `person_id` (rows follow their event).
- Photos: survivor keeps its own `image_url`; if it is empty and the other has
  one, take the other's. Never delete the loser's file.
- Delete the other person last. Cascades must not remove the moved rows.
- If the sources or event_media tables do not exist (module not installed),
  skip that step without failing. Check with `sqlite_master`.

## UI

- A **Merge with another person…** button at the bottom of the person panel,
  added through `onPersonPanelRendered`. Hidden in the read-only view.
- Dialog: choose the other person from a searchable list (exclude the
  survivor), then a field table with three columns — field, keep survivor,
  take other. Show each value; preselect the rule above. Show a summary:
  "N links, N events, N sources will move. <Name> will be deleted."
- Confirm requires typing the other person's name, because this cannot be
  undone by Ctrl+Z. The snapshot name is offered in the success toast.
- After success: select the survivor, `await loadTree(); render();`.
- Also expose `window.openMergeDialog(aId, bId)` so tree-health can offer it.

## Tests

- Fields: explicit wins; empty survivor field takes other's; both non-empty
  keeps survivor.
- Links move and duplicate links are dropped; self-link dropped.
- Events move; exact duplicate dropped.
- Sources move when the table exists; merge still works when it does not.
- The other person is gone; survivor remains.
- Self-merge and unknown ids rejected.

## Out of scope

Undo (the snapshot is the undo), merging more than two at once, merging
relationships of different types.
