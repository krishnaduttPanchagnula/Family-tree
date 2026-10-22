# Spec: Blank tree worksheet (`worksheet`)

## Objective

A printable blank family tree for a school project or a family reunion: no
data, just boxes to fill in by hand. Treemily and Creately both rank for this;
an offline app can hand it over with no sign-up. Frontend only.

## Behaviour

Tools launcher entry **Blank worksheet** (`i-poster`).

Dialog options:

- Paper: A4 or Letter.
- Orientation: portrait or landscape.
- Generations: 3, 4 or 5.
- Photo boxes: on/off.
- Title line: free text, default "My family tree", plus an optional subtitle
  line ("Name: ______").
- Generation labels: on/off (e.g. "Great-grandparents", "Grandparents",
  "Parents", "Me", "Children").

Preview opens a new window containing the sheet at true page size, white
background, dark text, no app chrome, and calls nothing external. The fonts
link is `/static/fonts.css`; the sheet must also read correctly with a serif
fallback. A Print button in the dialog opens the preview and calls
`print()` after load.

The sheet is a centred pyramid: one box at the bottom generation ("Me"),
doubling to the left and right above it for the chosen number of generations.
Each box is an empty outlined rectangle with a thin baseline inside for a name
and, when enabled, a small square at the top-left for a photo. The boxes must
never overlap at A4 portrait for five generations (scale type and gaps down;
a 5-generation sheet may use 8 mm boxes with 5 pt labels).

## Definition of done

- `node --check web/feat-worksheet.js` passes.
- Opens and prints with an empty tree, and does not read any family data.
- Print preview shows exactly one page for each combination of the options.
- No external requests (fonts are served by the app).

## Out of scope

Filling boxes from the tree, saving the sheet as PDF from Go, clip art.
