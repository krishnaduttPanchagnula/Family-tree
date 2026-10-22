# Family Tree Builder

Family Tree Builder is a small Go web app for creating an interactive family tree. It stores people and relationships in SQLite, lets you arrange the tree visually, attach photos, and export the final tree as an image.

Everything runs on your own machine: no account, no subscription, no upload of
your family data anywhere. For how this compares to the rest of the category,
see [`competitor-research.md`](competitor-research.md).

## Features

- Interactive, expandable canvas for building a family tree
- Drag-and-drop positioning for each person
- One **Add** button in the canvas tool rail is the single place to add a person, a parent, a partner, a sibling or a child
- Canvas tool rail grouping zoom, fit, auto-layout, centre, link, legend and export by purpose
- Life events per person (marriage, residence, education, immigration…) with a family timeline
- Sources per person and per event: the census, certificate, photograph, interview or story behind a fact
- "Check my tree": duplicates, impossible dates, unlinked people, missing dates, places and photos
- Merge two people into one record, field by field, with a snapshot written first
- A photo manager that lists every file on disk, who uses it, and what nobody uses
- Files (photo or PDF) attached to a life event
- This month in the family: birthdays, anniversaries and the days worth remembering
- Search filters for living or deceased, with or without a photo, by decade, and by branch
- Household layout (partners and their children grouped) and family lines in separate columns
- Chart options: connector weight, one colour or the colour of the relation, and a generation limit
- Printable reports: ancestors, descendants, missing information and sources
- A blank family tree worksheet to fill in by hand
- Relationship finder: how two people are related, with the path between them
- Layout modes: ancestors above, compact, fan, or centred on one person
- Tree styles: top-to-bottom or left-to-right, straight / elbow / curved
  connections, rounded or square cards
- Reloading re-arranges the tree back into generations, so a tree dragged into
  a mess snaps back
- Printable charts: family, ancestor and descendant layouts, portrait or landscape, A4 or Letter
- Manual connection editing between existing people, with a picker for each
  person in the link dialog
- Person profile fields:
  - Name
  - Date of birth
  - Date of death
  - Place of birth
  - Profession
  - Interesting facts / biography notes
- Photo uploads with crop, zoom, and reposition preview before saving
- Multiple photo storage modes:
  - Local disk
  - AWS S3
  - Google Drive
- Relationship styling for spouses, children, full siblings, half siblings, and step siblings
- Richer relationship subtypes: adoptive parent, foster parent, guardian, unknown parent, and divorced partner
- Toggleable relationship legend that explains each color and line style
- Header search across names, places, and professions, with jump-to and canvas highlight
- Breadcrumb trail from the selected person up to the root of the tree
- Per-person connections list with one-click unlink
- Undo for destructive actions (`Ctrl+Z` or the header Undo button)
- Confirmation dialog for deletes and other risky actions (no browser `confirm()`)
- One-click JSON backup download and restore-from-backup
- Full backup as a zip, including every uploaded photo
- Automatic local snapshots (every 30 minutes) with restore and delete
- GEDCOM import and export, plus CSV export of people and relationships
- Read-only link for showing the tree to family on your own network
- Kiosk mode (`?kiosk=1`) for showing the tree full screen
- First-run getting-started checklist that tracks your progress
- Keyboard shortcuts: `/` focuses search, `Ctrl+Z` undoes, `Esc` exits connect mode
- Minimal modern themes: White, Black, Tokyo Night, Sand, and Milan
- Zoom, pan, recenter, and center-tree controls
- Parent-to-child generation auto-layout reset for cleaning up manually moved nodes
- Export to JPEG, PNG, SVG, or raw JSON
- App update checker that compares the running version with the latest GitHub release
- Dockerfile + docker-compose.yml for one-command local testing (with an optional hot-reload dev service)
- GoReleaser-powered release pipeline for tags matching `v*`

### Interface

- A drawn icon set (one family, one stroke weight, `currentColor`) instead of
  emoji or typographic glyphs
- One vertical tool rail on the right edge of the canvas, so the tools never
  cover the top of the tree
- Detail panel that turns into a drawer below 820px, leaving the whole screen
  for the chart
- Save stays disabled until a field actually changes
- Visible focus rings, AA-contrast secondary text in every theme, and themed
  scrollbars and text selection
- Display type (brand, person names, dialog titles) is set in Source Serif 4
  for an archival feel; interface text stays in Inter
- The fonts are served from this machine, so opening the app makes no request
  to anyone else

### Two URLs worth knowing

| URL | What it does |
| --- | --- |
| `/?kiosk=1` | Full-screen tree for a tablet or TV. `Esc` leaves it. |
| `/?share=TOKEN` | Read-only view. The link is created in Settings › Sharing. |

### Feature modules

The frontend is plain files with no build step. `web/app.js` holds the core
app; each feature lives in its own `web/feat-*.js` + `web/feat-*.css` pair and
is loaded from `index.html`:

| Module | Feature |
| --- | --- |
| `feat-print` | Printable family, ancestor and descendant charts (A4/Letter, portrait/landscape) plus CSV links |
| `feat-relations` | How two people are related, with the path between them |
| `feat-layout` | Layout modes: ancestors above, compact, fan, centred on one person |
| `feat-timeline` | Life events per person and the family-wide timeline |
| `feat-data` | GEDCOM import/export, full backup with photos, local snapshots |
| `feat-share` | Read-only link and kiosk mode |
| `feat-styles` | Tree look: direction, connections, card shape, connector weight and generation limit |
| `feat-tools` | The launcher that holds the new tools |
| `feat-common` | The small helpers the feature modules share |
| `feat-sources` | The sources (the evidence) of a person and of an event |
| `feat-person-merge` | Merging two people into one record |
| `feat-event-media` | Files attached to a life event |
| `feat-tree-health` | "Check my tree" |
| `feat-photo-manager` | The files in the uploads folder and who uses them |
| `feat-export-wipe` | Starting fresh: backup, then empty the tree |
| `feat-calendar` | This month in the family |
| `feat-reports` | The printable reports |
| `feat-search-filters` | The filters on the search |
| `feat-worksheet` | The blank family tree worksheet |
| `feat-household-view` | The household layout |
| `feat-multi-tree` | The family lines |

### API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/persons`, `/api/relationships` | List data |
| `POST` | `/api/persons`, `/api/relationships` | Create (relationships are validated) |
| `PATCH`, `DELETE` | `/api/persons/{id}` | Update / delete a person (delete is undoable) |
| `POST` | `/api/persons/{id}/photo` | Upload or replace a photo |
| `DELETE` | `/api/relationships/{id}` | Remove a link |
| `GET`, `POST` | `/api/events` | List / create a life event |
| `PATCH`, `DELETE` | `/api/events/{id}` | Update / delete a life event |
| `GET` | `/api/backup` | Download the full tree as JSON |
| `GET` | `/api/backup/archive` | Download the tree and the photos as a zip |
| `POST` | `/api/restore` | Replace the tree with an uploaded backup (undoable) |
| `POST` | `/api/undo` | Re-insert the most recently deleted data |
| `GET`, `POST` | `/api/snapshot`, `/api/snapshots` | Write a local snapshot / list them |
| `GET`, `DELETE` | `/api/snapshots/{name}` | Read or delete one snapshot |
| `GET` | `/api/gedcom` | Download the tree as GEDCOM |
| `POST` | `/api/gedcom/import` | Import a GEDCOM file |
| `GET` | `/api/export.csv` | Export people or relationships as CSV |
| `GET`, `POST`, `DELETE` | `/api/share` | Create, inspect or stop the read-only link |
| `GET`, `POST` | `/api/sources` | List the sources of a person or an event / add one |
| `PATCH`, `DELETE` | `/api/sources/{id}` | Edit / remove a source |
| `POST` | `/api/persons/merge` | Merge two people into one record |
| `GET` | `/api/tree-health` | What is missing, impossible or duplicated |
| `GET`, `DELETE` | `/api/photos` | List the files in the uploads folder / remove one |
| `GET`, `POST` | `/api/event-media` | List the files of an event / attach one |
| `PATCH`, `DELETE` | `/api/event-media/{id}` | Edit the caption / remove a file |
| `GET` | `/api/calendar?month=YYYY-MM` | The birthdays, anniversaries and events of a month |
| `GET` | `/api/reports/{kind}` | A report: ancestor, descendant, missing or sources |
| `POST` | `/api/wipe` | Empty the tree, after a snapshot and a typed `DELETE` |

## Run locally

With the Makefile:

```sh
make run
```

Or straight from Go:

```sh
go run .
```

> Run the app as a **package** (`go run .`), not as a single file
> (`go run main.go`). The code is split across `main.go`, `events.go`,
> `gedcom.go`, `backup.go` and `share.go`, and `go run main.go` compiles that
> one file on its own, so every helper in the other files comes back as
> "undefined".

Then open:

```text
http://localhost:8099
```

Use a different port with `PORT=9000 make run` (or `PORT=9000 go run .`).

The app creates/uses:

- `familytree.db` for SQLite data
- `uploads/` for local photo uploads
- `backups/` for automatic local snapshots

## Makefile targets

`make` on its own lists them. The useful ones:

| Target | What it does |
| --- | --- |
| `make run` | Start the app (`go run .`) |
| `make build` | Build `./bin/familytree` |
| `make test` | Run the tests |
| `make check` | Format check, `go vet` and the tests |
| `make cover` | Tests with a coverage summary |
| `make dev` | Run with hot reload (needs `air`) |
| `make docker` | Build and run the container |
| `make clean` | Remove build artefacts and the local database |

## Run with Docker

If you would rather not install Go, the app ships with a `Dockerfile` and
`docker-compose.yml`:

```sh
docker compose up --build
```

Then open http://localhost:8099. The database and photo uploads are written to
`./data/` on the host, so they survive image rebuilds and are easy to wipe.
Automatic snapshots are written to `./data/backups/`.

| Task | Command |
| --- | --- |
| Start the app | `docker compose up --build` |
| Start with hot reload | `docker compose up dev` |
| Stop | `docker compose down` |
| Reset all data | `docker compose down && rm -rf data/*` |
| Publish on another host port | `PORT=9000 docker compose up --build` |

Notes:

- Podman works too: `podman compose up --build`. With the standalone
  `podman-compose` client, enable the dev service explicitly:
  `podman-compose --profile dev up dev`.
- The `dev` service bind-mounts the repository and rebuilds whenever a `*.go`,
  `web/*.js`, `web/*.css` or `web/*.html` file changes (config in `.air.toml`).
  Refresh the browser to see UI changes. Its database and `uploads/` are
  written to the repository root — exactly like `go run .` — and are
  gitignored.
- Only one service can listen on port 8099, so start either the default
  service or `dev`, never both at once.
- The containers run as root internally on purpose: rootless Podman maps uid 0
  back to your own account, so files in `./data` stay owned by you. With Docker
  you can run as your own user by adding
  `user: "${UID:-1000}:${GID:-1000}"` to a service in `docker-compose.yml`.
- Optional configuration is read from the environment or a `.env` file in the
  project root — copy `.env.example` to `.env` to start from a template.

## Configuration

Values are read from the environment. When running with Docker, put them in a
`.env` file in the project root (see `.env.example`) or export them before
`docker compose up`.

### Google Drive uploads

Set these environment variables before starting the app:

```sh
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

### AWS S3 uploads

The app uses the default AWS credential chain, so any of these can work:

- AWS environment variables
- `~/.aws/credentials`
- an instance/task role

You can select a bucket from the app after choosing the AWS S3 storage mode.

### Update checker

The update button calls GitHub's latest release API and compares the running app version with the latest release tag.

It polls `krishnaduttPanchagnula/Family-tree` by default, so updates are found out of the box — including `go run .` and Docker builds. Release builds overwrite the repository through GoReleaser using `GITHUB_REPOSITORY`.

To check a different repository (for example your own fork), set:

```sh
FAMILYTREE_RELEASE_REPOSITORY=your-name/Family-tree go run .
```

The repository can be in one of these formats:

- `owner/repo`
- `https://github.com/owner/repo`
- `git@github.com:owner/repo.git`

## Release workflow

This project includes:

- `.goreleaser.yaml`
- `.github/workflows/release.yml`

The GitHub Actions workflow runs when a tag matching `v*` is pushed.

```sh
git tag v0.4.0
git push origin v0.4.0
```

The release workflow will:

1. Check out the repository
2. Set up Go from `go.mod`
3. Install the CGO build tools and the cross-compilers (SQLite needs cgo)
4. Run `go test ./...`
5. Build and publish a GitHub release with GoReleaser
6. Replace the generated notes with the matching `CHANGELOG.md` section

## UX ideas to make family tree creation better

These are high-impact features that would improve the user experience.
Sections marked **done** are already implemented.

Competitive research behind this list lives in
[`competitor-research.md`](competitor-research.md).

### Guided onboarding — done

A first-run checklist walks users through:

1. Add yourself or a root family member
2. Add parents
3. Add partner
4. Add children
5. Add photos
6. Export or share the tree

This reduces the blank-canvas problem for new users. Reopen it from Settings.

### Auto-layout — done

`Auto-layout` in the tool rail arranges everyone into parent-to-child
generations, and `Centre` frames the selected person.

Useful modes:

- Ancestors above, descendants below — done
- Compact family view — done
- Fan/tree view — done
- Center on selected person — done

### Better relationship model — mostly done

The UI supports common family links plus richer subtypes for real families:

- Adoptive parent — done
- Foster parent — done
- Guardian — done
- Divorced/separated partner — done
- Unknown parent — done
- Multiple families/households — done in the layout (the household layout
  groups a partner and their children)

### Search and quick navigation — mostly done

Large trees need fast navigation. Helpful additions:

- Search by name — done (also matches places and professions)
- Filter by country, profession, or generation — done for country/profession
- Jump to person — done
- Breadcrumb path from selected person to root — done

### Timeline view — done

Life events (marriage, divorce, residence, education, occupation,
immigration) are stored per person and shown as a timeline in the sidebar,
with a family-wide view grouped by year and generation.

### Person detail pages — mostly done

A focused person profile could include:

- Full biography — done (the Bio tab)
- Gallery of photos — done (the Photo tab)
- Documents and records — done (the Files tab: files attached to a life event)
- Sources/citations — done (the Sources tab)
- Notes from relatives — not yet
- Relationship summary — done (the Family tab)

### Import support

To help users bring existing family data:

- GEDCOM import/export — done, and an import now reports who was already in
  the tree
- CSV import — export is done (`/api/export.csv`), import is not
- JSON restore from exported data — done

### Collaboration and sharing

Family trees are often built with relatives. Possible improvements:

- Read-only share links — done (a link on your own network, no account)
- Invite collaborators
- Change history
- Comments on people
- Suggested edits flow

### Data safety — mostly done

Important for user trust:

- One-click backup — done
- Restore from backup — done
- Full backup with the photos (zip) — done
- Automatic local snapshots every 30 minutes, restorable — done
- Scheduled export — done (the snapshots are the schedule)
- Clear location of local database and uploads — done (shown in Settings)
- Warning before deleting people with many relationships — done (confirm dialog shows the impact)
- Undo for destructive person and relationship actions — done (life events are
  restored with the person, but deleting an event itself is not undoable)
- A snapshot before a merge or a wipe — done
- Check the tree for missing, impossible or duplicated data — done
- Merge two people into one record — done

### Accessibility and mobile improvements

Helpful upgrades:

- Keyboard navigation — done (cards are focusable, `Enter`/`Space` selects)
- Better focus states — done
- Larger tap targets on mobile
- Responsive sidebar/drawer layout — done
- High-contrast mode

## Development notes

Run tests:

```sh
make test        # or: go test ./...
```

Check GoReleaser config locally, if GoReleaser is installed:

```sh
goreleaser check
```

Create a local snapshot build:

```sh
goreleaser release --snapshot --clean
```
