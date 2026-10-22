# Changelog

All notable changes to Family Tree Builder are recorded here. Each release
section is used verbatim as the GitHub release notes.

## v0.3.0

A local-first release: a redesigned interface, and a set of features that keep
a family tree on your own machine — no account, no subscription, no data
leaving the house.

### New interface

- **A drawn icon set** replaces every emoji and typographic glyph: one
  family, one stroke weight, drawn in `currentColor`.
- **A vertical tool rail** on the right edge of the canvas, so the tools
  never cover the top of the tree.
- **One Add button** is the single place to add a person, a parent, a partner,
  a sibling or a child. It names the person the relative would be added to.
- **The detail panel becomes a drawer** below 820px, leaving the whole screen
  for the chart.
- **Save stays disabled** until a field actually changes.
- **Visible focus rings, AA-contrast secondary text in every theme, themed
  scrollbars and text selection.**
- **Source Serif 4** sets the display voice (brand, person names, dialog
  titles); Inter stays for interface text.
- **The fonts are served from the app itself**, so opening it makes no request
  to any outside service.

### Printable charts
- Print a **family chart, an ancestor chart or a descendant chart**, portrait
  or landscape, on A4 or Letter.
- A live preview of the exact sheet, then the browser's own print dialog —
  choose "Save as PDF" for a file.

### Finding a relation

- Pick two people and see **how they are related**: parents, partners,
  siblings, aunt and niece, first cousins, second cousins once removed.
- The **path between them** is shown as a chain of cards, with the shared
  ancestors and the number of generations apart.

### Layout modes

- Arrange the tree **with ancestors above**, **compact**, as a **fan**, or
  **centred on one person**. Every arrangement can be undone with `Ctrl+Z`.

### Life events and a family timeline

- Record **marriage, divorce, residence, education, occupation and
  immigration** events per person, each with a date, place, title and note.
- A **sidebar timeline** for the selected person, and a **family-wide
  timeline** grouped by year and generation.
- Events are included in every backup, snapshot and GEDCOM file.

### Files and interchange

- **GEDCOM import and export** — the format other genealogy tools read.
  Re-importing the same file never duplicates people or connections.
- **CSV export** of people and of relationships.
- **A full backup as a zip**, containing the database *and* every uploaded
  photo.
- **Automatic local snapshots** every 30 minutes, with restore and delete.
  Everything is written to a `backups/` folder you can copy to a USB stick.

### Sharing without an account

- **A read-only link** for showing the tree to family on your own network.
  Viewers can look but not change anything; the server refuses every write
  while the link is open.
- **Kiosk mode** (`?kiosk=1`) for showing the tree full screen on a tablet
  or TV at a gathering. `Esc` leaves it.

### Tree styles

- **Direction**: run the generations top to bottom, or left to right like a
  line of descent. The choice is remembered.
- **Connections**: straight lines, right-angled elbows, or soft curves.
- **Cards**: rounded or square.
- Changing the direction re-arranges the tree and can be undone.

### Linking two people

- The **Link** button starts link mode; the banner names the person you have
  picked and that card is marked on the tree.
- The link dialog now has a **picker for each person**, so a link can be made
  from the list as well as by clicking two cards.
- Leaving link mode no longer leaves a half-finished pick behind.

### Everything from earlier releases, still here

- Interactive, expandable canvas with drag-and-drop positioning.
- Person fields: name, dates, place of birth, profession, notes.
- Photo upload with crop, zoom and reposition before saving.
- Photo storage on local disk, AWS S3 or Google Drive.
- Relationship styling for partners, children, full, half and step siblings.
- Richer relationship types: adoptive, foster and guardian parents, unknown
  parents, and divorced partners.
- Toggleable relationship legend, header search with jump-to and highlight,
  and a breadcrumb trail to the earliest ancestor.
- Per-person connections list with one-click unlink.
- Undo for destructive actions, confirmation dialogs with real impact text,
  and one-click JSON backup and restore.
- A first-run getting-started checklist and keyboard shortcuts (`/`, `Ctrl+Z`,
  `Esc`).
- Five themes: White, Black, Tokyo Night, Sand and Milan.
- Zoom, pan, fit, centre, and one-click generation auto-layout.
- Export to JPEG, PNG, SVG or raw JSON, and an in-app update checker.
- Docker and Docker Compose for one-command local testing, with a hot-reload
  development service, and a GoReleaser pipeline for tagged releases.

### For people building on the source

- **A Makefile**: `make run`, `make test`, `make check`, `make build`,
  `make cover`, `make dev`, `make docker`, `make clean`.
- **The app is a package, not a single file.** Run it with `go run .` (or
  `make run`) — `go run main.go` compiles that one file and leaves the rest of
  the package undefined.
- `PORT=9000 make run` picks a different port.
- 13 Go tests cover life events, GEDCOM round trips, CSV, the backup archive,
  snapshots, the read-only guard and the frontend asset contract.
- `competitor-research.md` records how this app compares with the rest of the
  family-tree category.
