# Spec: Chart options (`chart-options`)

## Objective

FamilyEcho lets you set line thickness, line colour and a generation limit.
The styles panel already covers direction, connector shape and card shape; add
these three, stored with the rest of the look.

## Behaviour

Extend the existing **Tree styles** dialog (`feat-styles.js` and
`feat-styles.css`; this module owns both in this wave). Keep the current three
groups and their behaviour.

New groups:

1. **Connections** → thickness: Thin (1.4), Normal (2.5), Bold (3.4). Applies
   to every connector immediately.
2. **Line colour** → `Relations` (the existing per-relation colours) or
   `Monochrome` (one muted ink colour, for printing). The legend keeps its
   relation colours either way.
3. **Shown generations** → All, or 2/3/4 generations **up and down from the
   selected person**. If nobody is selected, the control is disabled with the
   hint "Select a person first."; when the selected person changes, the view
   follows.

State lives in `localStorage` under `familytree.chartOptions`
(`{thickness:"normal", colour:"relations", generations:0}`), validated on load.
Do **not** try to store it in `treeStyle` (app.js owns that shape).

Expose, for the existing hooks in `app.js`:

- `window.connectorWidth()` → number.
- `window.connectorColour(relationColour)` → the relation colour, or the muted
  token value when monochrome (`cssVar('--muted', '#6b7280')`).
- `window.filterVisiblePersons(persons, relationships)` → the visible subset
  (everyone when generations is 0 or nobody is selected).
- `window.isPersonVisible(id)` → boolean, consistent with the list above.
Re-render (`render()`) after a change. The generation limit must not change
the data, only what is drawn; exporting prints what is shown.

## Definition of done

- `node --check web/feat-styles.js` passes.
- Each option survives a reload.
- Changing thickness changes the drawn connectors without a reload.
- With 3 generations and a selected grandchild, only that person, ancestors up
  to 3 and descendants down to 3 are drawn, and no dangling connectors remain.
- Resetting styles restores thin/normal/relations/all and the original three
  options.
- Read-only view: the dialog still works (it is a local view preference).

## Out of scope

Per-relation line colour pickers, background images, card width, print-only
overrides.
