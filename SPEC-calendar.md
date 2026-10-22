# Spec: This month in the family (`calendar`)

## Objective

FamilyEcho has a Calendar tab and Geni surfaces birthdays. The dates are
already in the tree; show them. A small, delightful reason to open the app.

## API

`GET /api/calendar?month=YYYY-MM` (default: the current month, server time)

```json
{
  "month": "2026-10",
  "birthdays": [{"person_id": 4, "name": "Ada", "date": "1815-12-10",
                 "day": 10, "age": 211, "living": false}],
  "anniversaries": [{"person_ids": [4, 9], "names": ["Ada", "William"],
                     "date": "1835-07-08", "day": 8, "years": 191,
                     "event_id": 12, "place": "London"}],
  "on_this_day": [{"person_id": 4, "name": "Ada", "kind": "born",
                   "date": "1815-12-10", "years_ago": 211}],
  "incomplete": [{"person_id": 7, "name": "Jo", "date": "1950-10",
                  "reason": "day unknown"}]
}
```

Rules:

- Parse `dob` as `YYYY-MM-DD`, `YYYY-MM` or `YYYY`. A full date matches by
  month and day. A `YYYY-MM` date with a matching month goes to `incomplete`,
  reason "day unknown". `YYYY` alone is ignored by the month view.
- Anniversaries come from events with `kind = "marriage"` and a parseable
  date. `years` = current year − event year (omit if the event year is
  unknown/future). Include `place` when present.
- `on_this_day` lists events whose month/day equals today's month/day, of any
  kind (birth/death from `dob`/`dod` included), newest year first, capped at
  20.
- `age` is the age the person turns this year, or would have; omit for unknown
  birth years. A deceased person's birthday still appears with `living:false`.
- Sort birthdays and anniversaries by day.
- Invalid `month` → 400. No people → empty arrays, 200.

## UI

Tools launcher entry **Dates** (`i-calendar`).

- Header with previous/next month and "Today". Three sections: Birthdays,
  Anniversaries, On this day. Each row: date, name(s), age/years, a person
  button that closes and calls `jumpToPerson`.
- Under Birthdays, a muted "Some dates only have a month" list from
  `incomplete`.
- Empty state per section, not a global one.
- Read-only view: identical (read-only tool).

## Tests

- Month filter includes only matching full dates; a `YYYY-MM` date lands in
  `incomplete`.
- Leap day (Feb 29) appears in February.
- Age and anniversary years computed from the current year.
- Marriage events only; a divorce event is not an anniversary.
- Invalid month 400; empty tree 200 with empty arrays.

## Out of scope

Recurring reminders, ICS export, notifications.
