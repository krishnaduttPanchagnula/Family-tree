# Spec: Household layout (`household-view`)

## Objective

The current layouts place people by generation. FamilyEcho groups a person
with their partner and children as one household, which reads like a family
rather than an org chart. Add that as one more arrangement. Frontend only.

## Behaviour

Tools launcher entry **Household layout** (`i-users`).

Dialog: one paragraph explaining the arrangement, a read-only count ("8
households, 23 people"), and Apply. If the tree is empty, show the empty state
and disable Apply.

Algorithm (client-side, using `currentPersons` and `currentRelationships`):

1. Build households: a household is a set of partners connected by `spouse`
   edges plus all children of any of those partners. A person with two spouses
   appears once, in one household, with both partners.
2. Assign each household a generation index: 0 for a household with no
   parents inside another household; otherwise the longest parent chain above
   it. A person belongs to exactly one household; process households in a
   deterministic order (earliest ancestor, then name) so the result is stable.
3. Place a household as a block: partners side by side (180 px apart), children
   in rows below, centred under the partners, 190 px per row and 180 px across.
   The household block width is the widest row.
4. Place blocks in generation rows, left to right, with a 120 px gap; wrap to a
   new band after roughly 2400 px. Never overlap blocks.
5. Set `pos_x`/`pos_y`, then persist every moved person with
   `savePersonPosition(p)` (fire and forget is fine), call `render()`, and
   `pushUndo({label:'Household layout', run: ...})` with the previous positions
   so Ctrl+Z restores them.

Read-only view: the dialog can show the description but Apply is disabled with
an explanation.

## Definition of done

- `node --check web/feat-household-view.js` passes.
- On a tree with two spouses, shared children, and a grandparent row, nobody
  overlaps and partners sit side by side.
- Applying twice is stable (same result), and Ctrl+Z restores the previous
  positions.
- Works with disconnected people (each becomes a one-person household).

## Out of scope

Changing the saved style, drawing household frames or labels, server-side
layout.
