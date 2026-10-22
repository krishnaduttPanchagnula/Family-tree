package main

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// CalendarBirthday is a birthday in the requested month.
type CalendarBirthday struct {
	PersonID int    `json:"person_id"`
	Name     string `json:"name"`
	Date     string `json:"date"`
	Day      int    `json:"day"`
	Age      int    `json:"age"`
	Living   bool   `json:"living"`
}

// CalendarAnniversary is a marriage anniversary in the requested month.
type CalendarAnniversary struct {
	PersonIDs []int    `json:"person_ids"`
	Names     []string `json:"names"`
	Date      string   `json:"date"`
	Day       int      `json:"day"`
	Years     int      `json:"years"`
	EventID   int      `json:"event_id"`
	Place     string   `json:"place"`
}

// CalendarEvent is something that happened on this day in some year.
type CalendarEvent struct {
	PersonID int    `json:"person_id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Date     string `json:"date"`
	YearsAgo int    `json:"years_ago"`
}

// CalendarIncomplete is a date that only has a month, so it cannot be put on
// a day.
type CalendarIncomplete struct {
	PersonID int    `json:"person_id"`
	Name     string `json:"name"`
	Date     string `json:"date"`
	Reason   string `json:"reason"`
}

// CalendarMonth is everything the family does in one month.
type CalendarMonth struct {
	Month         string                `json:"month"`
	Birthdays     []CalendarBirthday    `json:"birthdays"`
	Anniversaries []CalendarAnniversary `json:"anniversaries"`
	OnThisDay     []CalendarEvent       `json:"on_this_day"`
	Incomplete    []CalendarIncomplete  `json:"incomplete"`
}

// handleCalendar lists the birthdays, anniversaries and events of a month.
func handleCalendar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	month := strings.TrimSpace(r.URL.Query().Get("month"))
	now := time.Now()
	if month == "" {
		month = now.Format("2006-01")
	}
	year, monthNumber, err := parseMonth(month)
	if err != nil {
		http.Error(w, "month must look like 2026-10", http.StatusBadRequest)
		return
	}

	result := CalendarMonth{
		Month:         month,
		Birthdays:     []CalendarBirthday{},
		Anniversaries: []CalendarAnniversary{},
		OnThisDay:     []CalendarEvent{},
		Incomplete:    []CalendarIncomplete{},
	}

	persons, err := fetchAllPersons()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	names := map[int]string{}
	for _, p := range persons {
		names[p.ID] = p.Name
	}

	for _, p := range persons {
		date, ok := parsePartialDate(p.DOB)
		if !ok {
			continue
		}
		if date.month == 0 {
			continue // only a year is known
		}
		if date.month != monthNumber {
			continue
		}
		if date.day == 0 {
			result.Incomplete = append(result.Incomplete, CalendarIncomplete{
				PersonID: p.ID, Name: p.Name, Date: p.DOB, Reason: "day unknown",
			})
			continue
		}
		birthday := CalendarBirthday{
			PersonID: p.ID, Name: p.Name, Date: p.DOB, Day: date.day,
			Age: year - date.year, Living: p.DOD == "",
		}
		if birthday.Age < 0 {
			birthday.Age = 0
		}
		result.Birthdays = append(result.Birthdays, birthday)
	}

	events, err := fetchAllEvents()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	today := now
	for _, ev := range events {
		date, ok := parsePartialDate(ev.Date)
		if !ok || date.month != monthNumber || date.day == 0 {
			continue
		}
		if ev.Kind == "marriage" {
			anniversary := CalendarAnniversary{
				PersonIDs: []int{ev.PersonID}, Names: []string{names[ev.PersonID]},
				Date: ev.Date, Day: date.day, Years: year - date.year, EventID: ev.ID, Place: ev.Place,
			}
			if anniversary.Years < 0 {
				anniversary.Years = 0
			}
			result.Anniversaries = append(result.Anniversaries, anniversary)
		}
		if date.month == int(today.Month()) && date.day == today.Day() {
			result.OnThisDay = append(result.OnThisDay, CalendarEvent{
				PersonID: ev.PersonID, Name: names[ev.PersonID], Kind: ev.Kind,
				Date: ev.Date, YearsAgo: today.Year() - date.year,
			})
		}
	}

	// Births and deaths that fall on today's day are worth showing too.
	for _, p := range persons {
		for _, pair := range []struct {
			value string
			kind  string
		}{{p.DOB, "born"}, {p.DOD, "died"}} {
			date, ok := parsePartialDate(pair.value)
			if !ok || date.month != int(today.Month()) || date.day != today.Day() {
				continue
			}
			result.OnThisDay = append(result.OnThisDay, CalendarEvent{
				PersonID: p.ID, Name: p.Name, Kind: pair.kind,
				Date: pair.value, YearsAgo: today.Year() - date.year,
			})
		}
	}

	if len(result.OnThisDay) > 20 {
		result.OnThisDay = result.OnThisDay[:20]
	}
	jsonResponse(w, result)
}

// parseMonth reads YYYY-MM.
func parseMonth(value string) (int, int, error) {
	parts := strings.Split(strings.TrimSpace(value), "-")
	if len(parts) != 2 {
		return 0, 0, strconv.ErrSyntax
	}
	year, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, err
	}
	month, err := strconv.Atoi(parts[1])
	if err != nil || month < 1 || month > 12 {
		return 0, 0, strconv.ErrRange
	}
	return year, month, nil
}
