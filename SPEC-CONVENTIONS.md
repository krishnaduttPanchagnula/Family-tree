# Module conventions — v0.4

Read this with your `SPEC-<id>.md`. The module spec wins where they differ.

## Ownership

Create or modify only:

- `<id>.go`, `<id>_test.go` — backend modules
- `web/feat-<id>.js`, `web/feat-<id>.css` — every module
- `SPEC-<id>.md` is read-only for you.

**Never touch** `main.go`, `index.html`, `app.js`, `style.css`, `Makefile`,
`README.md`, `CHANGELOG.md`, or another module's files. Integration wires the
routes, the script and stylesheet tags and the central hooks. If you believe
you need a hook that does not exist, stop and report it instead of editing
`app.js`.

## Working copy

You are in a git worktree. Build, test and run the app there on a port above
8400 (`PORT=84xx go run .`). Commit **only your owned files** with
`git add <paths>`; leave any temporary wiring uncommitted so it is not merged.
Do not push, tag or open a PR.

## Go contract

- `package main`. Use the globals `db`, `jsonResponse(w, payload)` and
  `guardWrite(handler)`.
- `func init<Camel>()` creates your tables; `func register<Camel>()` registers
  your routes. Integration calls both from `main.go`. Report the exact route
  list in your final message.
- Parameterised SQL only. Trim text. Validate every id points at a real row.
- Status codes: 400 malformed, 404 missing row, 405 wrong method, 409 conflict.
- Multi-row writes run in one transaction. Call `writeSnapshot()` before a
  destructive write (see `backup.go`).
- No outbound network, no new dependencies.
- Every endpoint and every non-trivial computation gets a Go test in
  `<id>_test.go`, using the existing `useTempDB(t)`, `addPerson(t, ...)` and
  `addRelation(t, ...)` helpers. Cover one happy path and one rejection.

## JS contract

- Classic script, IIFE, `'use strict'`. No modules, no build step, no
  framework.
- Self-inject your stylesheet (copy `ensureStylesheet()` from
  `feat-layout.js`).
- Mount one `<dialog>` on `document.body`. Reuse `.dialog-form`,
  `.dialog-actions`, `.btn-primary`, `.btn-secondary`, `.field-label` from
  `style.css`. Use a local `esc()` for every user value.
- Register in the launcher:
  `window.FamilyTools.register({id, title, description, icon:'i-…', open: openXDialog})`
  and also expose `window.openXDialog`. Pick an existing symbol from the
  sprite in `index.html` (the icon test will fail on an unknown one).
- Person-panel sections: implement `window.onPersonPanelRendered(person)`.
  Remove your previous section before appending, because it runs on every
  selection.
- Available globals: `currentPersons`, `currentRelationships`, `findPerson`,
  `loadTree`, `render`, `showToast(message, isError)`, `showConfirm({title,
  message, confirmLabel, danger})` → `Promise<boolean>`, `isReadOnlyView()`,
  `pushUndo({label, run})`, `escapeHtml`, `escapeAttr`, `formatDate`.
- Every write checks `isReadOnlyView()` first and hides write controls in the
  shared read-only view. After a write: `await loadTree(); render();`.
- Destructive actions go through `showConfirm` with the consequence spelled
  out.
- Accessibility: every control labelled, focus visible, text contrast ≥ 4.5:1,
  no emoji or ad-hoc glyphs. Dialogs close on Esc natively.

## Definition of done

- `gofmt -w` clean, `go vet ./...` clean, `go test ./...` green.
- `node --check web/feat-<id>.js` clean.
- The module works with an empty tree, one person, and a large tree.
- Final report: owned files, endpoints, the exact wiring lines integration
  must add, and any known limit.
