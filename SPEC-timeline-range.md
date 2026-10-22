# Spec: Timeline range and generations (`timeline-range`)

## Objective

The family timeline shows every event at once. On a tree with centuries of
dates that is a wall. Add a range filter and an optional generation grouping.
Own `web/feat-timeline.js` and `web/feat-timeline.css` in this wave.

## Behaviour

At the top of the existing events panel, add a compact toolbar:

- **Range**: All time / 1800–1899 / 1900–1949 / 1950–1999 / 2000–today /
  Custom (two year inputs). Default: All time.
- **Group by generation**: off/on. When on, entries are grouped under headings
  derived from the selected person's tree depth: "Grandparents",
  "Parents", "This generation", "Children", "Grandchildren", "N generations
  down/up". People outside the selected person's tree go under "Other".
  When off, keep today's flat chronological list.
- A count line: "24 of 61 events".

Rules:

- Filter by the event's year parsed from its `date`; events with no parseable
  year are shown under **Undated** when the range is All time, and hidden for a
  specific range (state this in a muted note: "3 undated events hidden").
- Derived birth/death entries (the module already synthesises them from
  `dob`/`dod`) obey the same filter.
- State persists in `localStorage` under `familytree.timelineRange`
  (`{from:null,to:null,group:false}` or a preset id); validate on load.
- Adding, editing and deleting events keeps working and re-applies the filter.
- The read-only view keeps the filters (they only change what is shown).

## Definition of done

- `node --check web/feat-timeline.js` passes.
- Presets, custom range and grouping work on a mixed tree; undated entries are
  handled as specified.
- The filter survives reloads and a person change.
- No regression: add/edit/delete event still works, and the birth/death
  synthesis is unchanged when the range is All time.

## Out of scope

A draggable timeline visualisation, date-range maths across calendars, export.
