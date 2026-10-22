# Spec: Photo manager (`photo-manager`)

## Objective

Every photo the app has ever received sits in `uploads/`, and nothing ever
removes one. Show what is there, who uses it, and what nothing uses. This is
FamilyEcho's file manager, made useful for a local disk.

## API

`GET /api/photos`

```json
{
  "photos": [{
    "file": "1712_portrait.jpg",
    "url": "/uploads/1712_portrait.jpg",
    "size": 20480,
    "modified": "2026-10-22T18:00:00Z",
    "used_by": [{"person_id": 4, "name": "Ada"}],
    "event_media": [{"event_id": 9, "person_id": 4, "caption": "Wedding"}],
    "orphan": false
  }],
  "totals": {"files": 12, "bytes": 4000000, "orphans": 3, "orphan_bytes": 900000}
}
```

- Scan `./uploads` only, non-recursive, regular files. Ignore dotfiles.
- A file is used when `persons.image_url` or `event_media.file_url` ends with
  `/uploads/<file>` (also accept a bare `<file>` in those columns).
- `event_media` is optional: if the table is missing, report an empty list.
- Sort orphans first, then by name.

`DELETE /api/photos?file=<name>&force=0|1`

- Reject anything where `filepath.Base(name) != name`, the name contains a
  separator, or the resolved path is not inside `./uploads` → 400.
- Missing file → 404.
- Used file with `force=0` → 409 with the names of the users.
- `force=1`: clear the referencing `persons.image_url` (set to `''`), delete
  the referencing `event_media` rows, then remove the file.
- Respond `{deleted:true, cleared:{persons,media}}`.

## UI

- Tools launcher entry **Photos** (`i-image`).
- Summary line: "12 files · 3.8 MB · 3 not used by anyone".
- Grid of cards: thumbnail (`<img loading="lazy">`), file name, size, used-by
  links that close the dialog and call `jumpToPerson(id)`, or an "Unused"
  badge. Delete button per card; for a used file the confirmation names the
  people, and forces only after a second explicit confirmation.
- **Delete all unused** button, disabled at zero, confirmation states the count
  and the space freed.
- Refresh the grid after each delete; refresh the tree if people were cleared.
- Read-only view: list only, no delete buttons.

## Tests

- List marks a file used by a person and an unused file as orphan.
- Traversal attempts (`../secret`, `/etc/passwd`, `a/b.jpg`) return 400.
- Used file without force returns 409 and keeps the file; with force clears
  the reference and deletes the file.
- Missing file 404.
- Totals add up.

## Out of scope

Uploading from this screen, moving files, resizing, deduplicating by hash.
