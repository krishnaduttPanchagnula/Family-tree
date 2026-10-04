# Family Tree Builder

Family Tree Builder is a small Go web app for creating an interactive family tree. It stores people and relationships in SQLite, lets you arrange the tree visually, attach photos, and export the final tree as an image.

## Features

- Interactive, expandable canvas for building a family tree
- Drag-and-drop positioning for each person
- Quick actions to add parents, siblings, partners, and children
- Manual connection editing between existing people
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
- First-run getting-started checklist that tracks your progress
- Keyboard shortcuts: `/` focuses search, `Ctrl+Z` undoes, `Esc` exits connect mode
- Minimal modern themes: White, Black, Tokyo Night, Sand, and Milan
- Zoom, pan, recenter, and center-tree controls
- Parent-to-child generation auto-layout reset for cleaning up manually moved nodes
- Export to JPEG, PNG, SVG, or raw JSON
- App update checker that compares the running version with the latest GitHub release
- Dockerfile + docker-compose.yml for one-command local testing (with an optional hot-reload dev service)
- GoReleaser-powered release pipeline for tags matching `v*`

### API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/persons`, `/api/relationships` | List data |
| `POST` | `/api/persons`, `/api/relationships` | Create (relationships are validated) |
| `PATCH`, `DELETE` | `/api/persons/{id}` | Update / delete a person (delete is undoable) |
| `POST` | `/api/persons/{id}/photo` | Upload or replace a photo |
| `DELETE` | `/api/relationships/{id}` | Remove a link |
| `GET` | `/api/backup` | Download the full tree as JSON |
| `POST` | `/api/restore` | Replace the tree with an uploaded backup (undoable) |
| `POST` | `/api/undo` | Re-insert the most recently deleted data |

## Run locally

```sh
go run .
```

Then open:

```text
http://localhost:8099
```

The app creates/uses:

- `familytree.db` for SQLite data
- `uploads/` for local photo uploads

## Run with Docker

If you would rather not install Go, the app ships with a `Dockerfile` and
`docker-compose.yml`:

```sh
docker compose up --build
```

Then open http://localhost:8099. The database and photo uploads are written to
`./data/` on the host, so they survive image rebuilds and are easy to wipe.

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
git tag v0.1.0
git push origin v0.1.0
```

The release workflow will:

1. Check out the repository
2. Set up Go from `go.mod`
3. Install CGO build tools for SQLite support
4. Run `go test ./...`
5. Build and publish a GitHub release with GoReleaser

## UX ideas to make family tree creation better

These are high-impact features that would improve the user experience.
Sections marked **done** are already implemented.

### Guided onboarding — done

A first-run checklist walks users through:

1. Add yourself or a root family member
2. Add parents
3. Add partner
4. Add children
5. Add photos
6. Export or share the tree

This reduces the blank-canvas problem for new users. Reopen it from Settings.

### Auto-layout

Add an automatic layout button that arranges generations vertically or horizontally. Users could still drag people manually afterward, but auto-layout would help large trees stay readable.

Useful modes:

- Ancestors above, descendants below
- Compact family view
- Fan/tree view
- Center on selected person

### Better relationship model — mostly done

The UI supports common family links plus richer subtypes for real families:

- Adoptive parent — done
- Foster parent — done
- Guardian — done
- Divorced/separated partner — done
- Unknown parent — done
- Multiple families/households

### Search and quick navigation — mostly done

Large trees need fast navigation. Helpful additions:

- Search by name — done (also matches places and professions)
- Filter by country, profession, or generation — done for country/profession
- Jump to person — done
- Breadcrumb path from selected person to root — done

### Timeline view

A timeline can make family history easier to understand:

- Births
- Deaths
- Marriages/partnerships
- Migrations
- Important life events

### Person detail pages

A focused person profile could include:

- Full biography
- Gallery of photos
- Documents and records
- Sources/citations
- Notes from relatives
- Relationship summary

### Import support

To help users bring existing family data:

- GEDCOM import/export
- CSV import
- JSON restore from exported data

### Collaboration and sharing

Family trees are often built with relatives. Possible improvements:

- Read-only share links
- Invite collaborators
- Change history
- Comments on people
- Suggested edits flow

### Data safety — partially done

Important for user trust:

- One-click backup — done
- Restore from backup — done
- Scheduled export
- Clear location of local database and uploads — done (shown in Settings)
- Warning before deleting people with many relationships — done (confirm dialog shows the impact)

### Accessibility and mobile improvements

Helpful upgrades:

- Keyboard navigation
- Better focus states
- High-contrast mode
- Larger tap targets on mobile
- Responsive sidebar/drawer layout

## Development notes

Run tests:

```sh
go test ./...
```

Check GoReleaser config locally, if GoReleaser is installed:

```sh
goreleaser check
```

Create a local snapshot build:

```sh
goreleaser release --snapshot --clean
```
