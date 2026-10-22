# Spec: Family lines on one canvas (`multi-tree`)

## Objective

Most families are several unconnected lines — a maternal side, a paternal
side, a partner's family. Treemily's Forrest Tool keeps them apart instead of
letting the auto-layout scatter them. Arrange each line in its own column and
name it, without changing the data model. Frontend only.

## Behaviour

Tools launcher entry **Family lines** (`i-tree`).

Dialog:

- Detect connected components from `currentRelationships` (ignore direction).
- Name each line by the most common surname among its members (last
  whitespace-separated word of the name, case-insensitive), falling back to
  "Family line N". If two lines share a surname, add the earliest birth year:
  "Whitfield (b. 1846)".
- List each line (name, number of people, earliest year) in descending size.
- Apply button: **Arrange the lines in columns**. Disabled with fewer than two
  lines, with the note "Everyone is already connected, so there is one line.".
- Empty state for an empty tree.

Arrangement:

- Order lines by the list (largest first).
- Within a line, arrange people in a compact grid (3 per row, 180 px across,
  190 px down) sorted by generation depth then name, so parents appear above
  children where the links exist.
- Place each line as a column block separated by a 260 px gutter, starting at
  (80, 80). Each person moves once.
- Persist with `savePersonPosition(p)`, call `render()`, and push an undo entry
  that restores the previous positions.
- After applying, toast "Arranged 3 family lines." and keep the dialog open so
  the user can see the list; close on request.

Read-only view: list only, Apply disabled.

## Definition of done

- `node --check web/feat-multi-tree.js` passes.
- Two disconnected pairs produce two named columns with a visible gutter.
- One component produces the disabled state, not a broken layout.
- Applying twice is stable; Ctrl+Z restores positions.
- A person with no relationships still lands in a line.

## Out of scope

Naming lines by hand, saving line metadata, drawing titles on the canvas,
filtering the canvas to one line.
