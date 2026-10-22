# Spec: Export and start fresh (`export-wipe`)

## Objective

A local-first app should let you leave cleanly. One action writes a complete
backup, then empties the tree. For a handover, a fresh start, or handing the
machine to someone else. Trust feature, not a convenience.

## API

`POST /api/wipe`

```json
{"confirm": "DELETE", "delete_photos": false}
```

- `confirm` must be exactly `DELETE`; otherwise 400 and nothing happens.
- Call `writeSnapshot()` first; abort with 500 if it fails.
- In a transaction delete, in order: `sources`, `event_media`, `events`,
  `relationships`, `persons` (skip tables that do not exist). `pending_photos`
  is not a table.
- `delete_photos=true`: after the data commit, remove regular files directly
  inside `./uploads` (never recurse, never follow a symlink out).
- Response:

```json
{"snapshot":"2026-10-22T18-00-00", "deleted":{"persons":12,"relationships":30,
 "events":8,"sources":4,"media":2},"photos_deleted":5}
```

- The route is wrapped in `guardWrite`, so a shared viewer gets 403.

## UI

- Tools launcher entry **Start fresh** (`i-trash` or `i-history`).
- Dialog shows the current counts and the snapshot that will be written.
  Requires typing `DELETE`. A checkbox "Also delete the N photos in
  uploads/" — unchecked by default, with the sentence "The backup archive
  keeps them.".
- A secondary link "Download a fullbackup first" → `/api/backup/archive`
  (same as the existing backup button).
- On success: close, `await loadTree(); render();`, toast naming the snapshot
  and the restore path ("Restore it from Settings → Snapshots").
- Read-only view: entry hidden or disabled with an explanation.

## Tests

- Missing/wrong confirm → 400, data untouched, no snapshot written.
- Correct confirm empties all tables (seed persons, links, events, sources,
  media first), returns counts, and writes a snapshot that can be listed.
- `delete_photos=false` keeps files; `true` removes only files directly in
  `uploads/` and leaves a nested file alone.
- Works when the optional tables do not exist.

## Out of scope

Restoring automatically, deleting backups or snapshots, clearing settings.
