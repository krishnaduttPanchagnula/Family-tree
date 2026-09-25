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
- Toggleable relationship legend that explains each color and line style
- Minimal modern themes: White, Black, Tokyo Night, Sand, and Milan
- Zoom, pan, recenter, and center-tree controls
- Parent-to-child generation auto-layout reset for cleaning up manually moved nodes
- Export to JPEG, PNG, SVG, or raw JSON
- App update checker that compares the running version with the latest GitHub release
- GoReleaser-powered release pipeline for tags matching `v*`

## Run locally

```sh
go run .
```

Then open:

```text
http://localhost:8019
```

The app creates/uses:

- `familytree.db` for SQLite data
- `uploads/` for local photo uploads

## Configuration

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

Release builds embed the GitHub repository automatically through GoReleaser using `GITHUB_REPOSITORY`.

For local development, configure the repository manually:

```sh
FAMILYTREE_RELEASE_REPOSITORY=owner/repo go run .
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

These are high-impact features that would improve the user experience:

### Guided onboarding

Add a first-run checklist that walks users through:

1. Add yourself or a root family member
2. Add parents
3. Add partner
4. Add children
5. Add photos
6. Export or share the tree

This would reduce the blank-canvas problem for new users.

### Auto-layout

Add an automatic layout button that arranges generations vertically or horizontally. Users could still drag people manually afterward, but auto-layout would help large trees stay readable.

Useful modes:

- Ancestors above, descendants below
- Compact family view
- Fan/tree view
- Center on selected person

### Better relationship model

The current UI supports common family links. A richer model could improve accuracy for real families:

- Adoptive parent
- Foster parent
- Guardian
- Divorced/separated partner
- Unknown parent
- Multiple families/households

### Search and quick navigation

Large trees need fast navigation. Helpful additions:

- Search by name
- Filter by country, profession, or generation
- Jump to person
- Breadcrumb path from selected person to root

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

### Data safety

Important for user trust:

- One-click backup
- Restore from backup
- Scheduled export
- Clear location of local database and uploads
- Warning before deleting people with many relationships

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
