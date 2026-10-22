# Spec: Sources & citations (`sources`)

## Objective

A family history is only as good as its evidence. Give every person (and
optionally one of their life events) a list of structured sources: a census, a
birth certificate, a gravestone photo, an interview, a remembered story. This
is the WikiTree idea the research singled out, kept entirely local.

## Data

```sql
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  event_id INTEGER DEFAULT 0,          -- 0 = about the person, not one event
  kind TEXT DEFAULT 'other',           -- census|birth|death|marriage|cemetery|
                                       -- photo|interview|memory|story|other
  title TEXT DEFAULT '',               -- "1901 census, Leeds"
  citation TEXT DEFAULT '',            -- the full citation line
  url TEXT DEFAULT '',                 -- an address to open; never fetched
  date TEXT DEFAULT '',                -- free-form, like the rest of the app
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(person_id) REFERENCES persons(id) ON DELETE CASCADE
);
```

Normalise `kind`; unknown → `other`. `event_id` must be 0 or an event that
belongs to the person.

## API

| Method | Path | Body / query | Result |
|---|---|---|---|
| GET | `/api/sources?person_id=N` | — | `[{source}]` |
| GET | `/api/sources?event_id=N` | — | `[{source}]` |
| GET | `/api/sources?all=1` | — | every source, for reports |
| POST | `/api/sources` | source without id | created source |
| PATCH | `/api/sources/{id}` | any subset of fields | updated source |
| DELETE | `/api/sources/{id}` | — | 204 |

Reject: unknown person (400), event that does not belong to the person (400),
unknown id (404), bad JSON (400). `all=1` with no other filter.

## UI

- A **Sources** tab inside the person panel, added through
  `onPersonPanelRendered`. Move the existing tab buttons? No: append a new tab
  button next to the events tab and a matching panel, using the same
  `tab-btn`/`tab-panel` classes and `switchTab` contract. Do not edit
  `index.html`; build the tab and panel in JS.
- List: kind badge, title, citation, date, an external link only when `url`
  is non-empty (target `_blank`, `rel="noopener noreferrer"`), edit and delete
  buttons.
- Add/edit form: kind select, title, citation (textarea), date, url, note.
  Save posts or patches, then reloads the list. Empty state explains what a
  source is in one sentence.
- Read-only view: list only, no add/edit/delete.
- Deleting asks "Delete the source “…”? The citation will be gone.".

## Tests

- CRUD round trip including `kind` normalisation.
- Missing person rejected; event from another person rejected.
- `all=1` returns sources from several people.
- Delete removes the row.

## Out of scope

Attaching files (that is `event-media`), fetching the URL, citations on
relationships.
