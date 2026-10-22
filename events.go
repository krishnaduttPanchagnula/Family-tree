package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// Event is a life event attached to a person: a birth, a marriage, a move.
// The person's own dob/dod stay on the person record; events add everything
// the two flat fields cannot express.
type Event struct {
	ID       int    `json:"id"`
	PersonID int    `json:"person_id"`
	Kind     string `json:"kind"`
	Date     string `json:"date"`
	Place    string `json:"place"`
	Title    string `json:"title"`
	Note     string `json:"note"`
}

// eventKinds are the kinds the UI offers. Anything else is stored as "other".
var eventKinds = map[string]bool{
	"birth": true, "death": true, "marriage": true, "divorce": true,
	"residence": true, "education": true, "occupation": true,
	"immigration": true, "other": true,
}

func initEventTable() {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		person_id INTEGER NOT NULL,
		kind TEXT DEFAULT 'other',
		date TEXT DEFAULT '',
		place TEXT DEFAULT '',
		title TEXT DEFAULT '',
		note TEXT DEFAULT '',
		FOREIGN KEY(person_id) REFERENCES persons(id) ON DELETE CASCADE
	)`)
	if err != nil {
		return
	}
	// Events created before a person was deleted would break rendering.
	db.Exec(`DELETE FROM events WHERE person_id NOT IN (SELECT id FROM persons)`)
}

func normaliseEventKind(kind string) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if eventKinds[kind] {
		return kind
	}
	return "other"
}

// handleEvents serves GET (list) and POST (create) for life events.
func handleEvents(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		events, err := fetchAllEvents()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(events)

	case http.MethodPost:
		var ev Event
		if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if ev.PersonID <= 0 {
			http.Error(w, "person_id is required", http.StatusBadRequest)
			return
		}
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM persons WHERE id = ?", ev.PersonID).Scan(&n); err != nil || n == 0 {
			http.Error(w, "person does not exist", http.StatusBadRequest)
			return
		}
		ev.Kind = normaliseEventKind(ev.Kind)
		res, err := db.Exec(`INSERT INTO events (person_id, kind, date, place, title, note)
			VALUES (?, ?, ?, ?, ?, ?)`,
			ev.PersonID, ev.Kind, strings.TrimSpace(ev.Date), strings.TrimSpace(ev.Place),
			strings.TrimSpace(ev.Title), strings.TrimSpace(ev.Note))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		newID, err := res.LastInsertId()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		ev.ID = int(newID)
		json.NewEncoder(w).Encode(ev)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleEventByID serves PATCH and DELETE for a single event.
func handleEventByID(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.URL.Path, "/api/events/")
	id, err := strconv.Atoi(strings.Trim(raw, "/"))
	if err != nil || id <= 0 {
		http.Error(w, "invalid event id", http.StatusBadRequest)
		return
	}

	var existing Event
	err = db.QueryRow(`SELECT id, person_id, kind, date, place, title, note FROM events WHERE id = ?`, id).
		Scan(&existing.ID, &existing.PersonID, &existing.Kind, &existing.Date,
			&existing.Place, &existing.Title, &existing.Note)
	if err == sql.ErrNoRows {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	switch r.Method {
	case http.MethodPatch:
		var body struct {
			Kind  *string `json:"kind"`
			Date  *string `json:"date"`
			Place *string `json:"place"`
			Title *string `json:"title"`
			Note  *string `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if body.Kind != nil {
			existing.Kind = normaliseEventKind(*body.Kind)
		}
		if body.Date != nil {
			existing.Date = strings.TrimSpace(*body.Date)
		}
		if body.Place != nil {
			existing.Place = strings.TrimSpace(*body.Place)
		}
		if body.Title != nil {
			existing.Title = strings.TrimSpace(*body.Title)
		}
		if body.Note != nil {
			existing.Note = strings.TrimSpace(*body.Note)
		}
		if _, err := db.Exec(`UPDATE events SET kind = ?, date = ?, place = ?, title = ?, note = ? WHERE id = ?`,
			existing.Kind, existing.Date, existing.Place, existing.Title, existing.Note, id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)

	case http.MethodDelete:
		if _, err := db.Exec("DELETE FROM events WHERE id = ?", id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func fetchAllEvents() ([]Event, error) {
	rows, err := db.Query(`SELECT id, person_id, kind, date, place, title, note FROM events ORDER BY date, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.PersonID, &e.Kind, &e.Date, &e.Place, &e.Title, &e.Note); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}
