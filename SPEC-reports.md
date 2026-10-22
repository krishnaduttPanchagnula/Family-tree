# Spec: Printable reports (`reports`)

## Objective

A chart is a picture; a report is a document. Gramps' most-used feature is its
text reports. Produce ancestor and descendant reports, a missing-information
checklist and a sources report, printable on A4 or Letter.

## API

`GET /api/reports/{kind}?root=<id>&gens=<n>`

Kinds: `ancestor`, `descendant`, `missing`, `sources`.

```json
{
  "kind": "ancestor",
  "title": "Ancestors of Ada Lovelace",
  "generated": "2026-10-22T18:00:00Z",
  "sections": [{
    "heading": "Parents",
    "subtitle": "Generation 1",
    "people": [{
      "id": 12, "name": "Ada Lovelace", "dates": "1815–1852",
      "birth_place": "London", "profession": "Mathematician",
      "facts": "…",
      "events": [{"kind":"marriage","date":"1835-07-08","place":"London","title":"","note":""}],
      "sources": [{"kind":"census","title":"1841 census","citation":"…","date":"1841","url":""}]
    }]
  }]
}
```

Rules:

- `root` defaults to nobody for `missing`/`sources`; for `ancestor`/
  `descendant` it is required (400 if missing/unknown). `gens` defaults to 4,
  must be 1–12 (400 otherwise).
- Ancestor: walk `father`/`mother`/`child` edges upward, one section per
  generation ("Parents", "Grandparents", …). Descendant: downward ("Children",
  "Grandchildren", …). Each section also lists the spouses of that
  generation's people, marked in the `dates`/name line only by inclusion (no
  new field). Do not repeat a person in two sections; use the closest
  generation.
- `missing`: sections per tree-health category, people listed with the same
  detail text (reuse `computeTreeHealth()`).
- `sources`: one section per person who has sources, heading the person's
  name; people without sources are omitted. If the `sources` table does not
  exist, return an empty `sections` list (200) with a note in `title`? No —
  return sections empty and a `notice` field.
- Include each person's events (all kinds, chronological) and sources when the
  table exists. Empty strings stay empty; the frontend omits blank rows.
- Read-only and cheap: no writes, no files.

## UI

Tools launcher entry **Reports** (`i-print`).

- Choose report kind; ancestor/descendant reveal a person picker (default the
  selected person) and a generations select (2–6, default 4). Missing/sources
  hide both.
- **Preview** opens a new window: white A4/Letter sheet, serif body, a title
  block ("Ancestors of …", date, "Family Tree Builder"), one section per
  generation with a rule, each person as a short entry (name, dates, place,
  profession, facts paragraph, events list, sources list). Page size chosen
  in the dialog (A4/Letter) and orientation (portrait/landscape).
- **Print** opens the preview and calls `print()` after load. The preview
  paginates with CSS `break-inside: avoid` on entries and `break-before: page`
  on sections that would split badly.
- Errors (no root selected) show inline, not a new window.
- Read-only view: identical (read-only tool).

## Tests

- Ancestor depth: root → parents → grandparents; `gens=1` only parents.
- Descendant depth; spouses appear; a person never appears twice.
- Missing root 400; `gens=0` and `gens=13` 400.
- Events and sources included; works when the sources table is absent.
- `missing` sections match the tree-health categories.
- Empty tree: 200 with empty sections for missing/sources.

## Out of scope

PDF generation on the server (the browser prints), footnotes/numbered
citations, photos in the report.
