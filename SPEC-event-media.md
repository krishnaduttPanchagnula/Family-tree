# Spec: Media on events (`event-media`)

## Objective

A wedding photo belongs to the wedding, not to a person in general. Let the
user attach photos and documents to a life event, the way Geni does.

## Data

```sql
CREATE TABLE IF NOT EXISTS event_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,          -- denormalised for easy panel queries
  kind TEXT DEFAULT 'photo',           -- photo|document
  file_url TEXT NOT NULL DEFAULT '',   -- /uploads/... or an external URL
  caption TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(person_id) REFERENCES persons(id) ON DELETE CASCADE
);
```

## API

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/events/{id}/media` | — | `[{media}]` |
| POST | `/api/events/{id}/media` | multipart `file`, `caption` | created media |
| PATCH | `/api/event-media/{id}` | `{caption}` | updated |
| DELETE | `/api/event-media/{id}` | — | 204 |

- Upload reuses `uploadImage(file, header)` from `main.go` (local, S3 or Drive
  as configured). Cap at 15 MB; reject other content types except images and
  PDFs. An empty file is 400.
- The event must exist; `person_id` is copied from the event, never trusted
  from the client.
- Deleting the row leaves the file on disk; the photo manager owns orphan
  files.

## UI

- A **Documents** section in the person panel, added through
  `onPersonPanelRendered`. For each of the person's events with media (and an
  "add" control for every event), show a thumbnail strip: images as thumbs,
  documents as a labelled file row. Click a photo to open it in a new tab.
- Upload: a file input plus a caption field per event, in a small form.
- Delete with confirmation naming the file.
- Read-only view: no upload/delete controls.

## Tests

- Multipart upload with a tiny PNG in a temp working directory (`t.Chdir`),
  then a list that includes it.
- Unknown event 404; empty file 400; oversized file 400.
- Delete removes the row but not the file.
- `person_id` comes from the event even if the form lies.

## Out of scope

Thumbnail generation, editing the file, media on relationships.
