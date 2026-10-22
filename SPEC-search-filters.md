# Spec: Search filters (`search-filters`)

## Objective

Search today matches one string and shows eight hits. FamilyEcho lets you
narrow by living status, a date range and whether a photo exists. Add the
useful half of that to the existing search, without changing how typing works.

## Behaviour

Frontend only; no Go. The app calls `window.searchHitAllowed(person)` for every
hit (the hook already exists in `app.js`). Return `true` when no filter is
active and `false` when the person fails any active filter.

Filters (AND):

- **Status**: any / living / deceased. Living = empty `dod`. Deceased =
  non-empty `dod`.
- **Photo**: any / with / without. Non-empty `image_url`.
- **Born in**: any / a decade present in the data (`1940s`). A person matches
  when `dob` starts with `194` and `0 <= last digit <= 9` — i.e. parse the
  first four characters of `dob` as a year; ignore people with no/invalid
  year.
- **Generation**: any / ancestors of the selected person / descendants of the
  selected person. Use parent-child edges (`father`, `mother`, `child`, and the
  `parentChildEdge` convention used in `app.js`). If nobody is selected, show
  this filter disabled with the hint "Select a person first".

When no filter is active the hook must not change results at all.

## UI

- A small **Filters** button appended inside `.search-box` after the `kbd`.
  Shows a dot and an accessible label when anything is active ("Filters, 2
  active").
- Clicking opens a compact popover dialog (same `.dialog-form` styling) with
  the four selects, a "Showing N of M people" line computed from
  `currentPersons`, and Clear all / Done buttons.
- Changing a filter re-runs the current search immediately
  (`renderSearchResults()`), without closing the popover.
- State is remembered in `localStorage` under `familytree.searchFilters` and
  validated on load (unknown values fall back to any).
- Keyboard: button reachable by Tab, dialog closes on Esc, every select has a
  label.

## Definition of done

- `node --check web/feat-search-filters.js` passes.
- No filter active → identical results to before.
- Filters combine; clearing restores everything.
- Works on the shared read-only view (filters are read-only).

## Out of scope

Changing the eight-result cap, searching by source text, saved searches,
filtering the canvas.
