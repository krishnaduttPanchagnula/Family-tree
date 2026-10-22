package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// Source is a piece of evidence for a person, or for one of their events.
// A family history is only as good as the sources behind it, so the evidence
// gets its own record instead of a line in a free-text box.
type Source struct {
	ID        int    `json:"id"`
	PersonID  int    `json:"person_id"`
	EventID   int    `json:"event_id"`
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	Citation  string `json:"citation"`
	URL       string `json:"url"`
	Date      string `json:"date"`
	Note      string `json:"note"`
	CreatedAt string `json:"created_at"`
}

// sourceKinds are the kinds the UI offers. Anything else is stored as
// "other", so a new kind never breaks an old record.
var sourceKinds = map[string]bool{
	"census": true, "birth": true, "death": true, "marriage": true,
	"cemetery": true, "photo": true, "interview": true, "memory": true,
	"story": true, "other": true,
}

func initSources() {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS sources (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		person_id INTEGER NOT NULL,
		event_id INTEGER DEFAULT 0,
		kind TEXT DEFAULT 'other',
		title TEXT DEFAULT '',
		citation TEXT DEFAULT '',
		url TEXT DEFAULT '',
		date TEXT DEFAULT '',
		note TEXT DEFAULT '',
		created_at TEXT DEFAULT (datetime('now')),
		FOREIGN KEY(person_id) REFERENCES persons(id) ON DELETE CASCADE
	)`)
	if err != nil {
		return
	}
	// Sources left behind by a deleted person would break the panel.
	db.Exec(`DELETE FROM sources WHERE person_id NOT IN (SELECT id FROM persons)`)
}

func normaliseSourceKind(kind string) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if sourceKinds[kind] {
		return kind
	}
	return "other"
}

// tableExists reports whether a table is in the database, so a module can
// work with the optional tables of other modules.
func tableExists(name string) bool {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&n)
	return err == nil && n > 0
}

// handleSources lists the sources of one person or one event, and creates new
// ones. GET /api/sources?person_id=N | ?event_id=N | ?all=1
func handleSources(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		query := r.URL.Query()
		if query.Get("all") == "1" {
			sources, err := fetchSources(`SELECT id, person_id, event_id, kind, title, citation,
				url, date, note, created_at FROM sources ORDER BY person_id, id`)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			jsonResponse(w, sources)
			return
		}

		personID, _ := strconv.Atoi(query.Get("person_id"))
		eventID, _ := strconv.Atoi(query.Get("event_id"))
		if personID <= 0 && eventID <= 0 {
			http.Error(w, "person_id or event_id is required", http.StatusBadRequest)
			return
		}

		var rows *sql.Rows
		var err error
		if eventID > 0 {
			rows, err = db.Query(`SELECT id, person_id, event_id, kind, title, citation,
				url, date, note, created_at FROM sources WHERE event_id = ? ORDER BY id`, eventID)
		} else {
			rows, err = db.Query(`SELECT id, person_id, event_id, kind, title, citation,
				url, date, note, created_at FROM sources WHERE person_id = ? ORDER BY id`, personID)
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		jsonResponse(w, scanSources(rows))

	case http.MethodPost:
		var src Source
		if err := json.NewDecoder(r.Body).Decode(&src); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if src.PersonID <= 0 {
			http.Error(w, "person_id is required", http.StatusBadRequest)
			return
		}
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM persons WHERE id = ?", src.PersonID).Scan(&n); err != nil || n == 0 {
			http.Error(w, "person does not exist", http.StatusBadRequest)
			return
		}
		if src.EventID > 0 {
			var owner int
			err := db.QueryRow("SELECT person_id FROM events WHERE id = ?", src.EventID).Scan(&owner)
			if err == sql.ErrNoRows {
				http.Error(w, "event does not exist", http.StatusBadRequest)
				return
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if owner != src.PersonID {
				http.Error(w, "the event belongs to another person", http.StatusBadRequest)
				return
			}
		}

		src.Kind = normaliseSourceKind(src.Kind)
		res, err := db.Exec(`INSERT INTO sources (person_id, event_id, kind, title, citation,
			url, date, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			src.PersonID, src.EventID, src.Kind, strings.TrimSpace(src.Title),
			strings.TrimSpace(src.Citation), strings.TrimSpace(src.URL),
			strings.TrimSpace(src.Date), strings.TrimSpace(src.Note))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		id, _ := res.LastInsertId()
		src.ID = int(id)
		jsonResponse(w, src)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleSourceByID edits or deletes a single source.
func handleSourceByID(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.URL.Path, "/api/sources/")
	id, err := strconv.Atoi(strings.Trim(raw, "/"))
	if err != nil || id <= 0 {
		http.Error(w, "invalid source id", http.StatusBadRequest)
		return
	}

	var existing Source
	err = db.QueryRow(`SELECT id, person_id, event_id, kind, title, citation, url, date, note, created_at
		FROM sources WHERE id = ?`, id).
		Scan(&existing.ID, &existing.PersonID, &existing.EventID, &existing.Kind,
			&existing.Title, &existing.Citation, &existing.URL, &existing.Date,
			&existing.Note, &existing.CreatedAt)
	if err == sql.ErrNoRows {
		http.Error(w, "source not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	switch r.Method {
	case http.MethodPatch:
		var body struct {
			Kind     *string `json:"kind"`
			Title    *string `json:"title"`
			Citation *string `json:"citation"`
			URL      *string `json:"url"`
			Date     *string `json:"date"`
			Note     *string `json:"note"`
			EventID  *int    `json:"event_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if body.Kind != nil {
			existing.Kind = normaliseSourceKind(*body.Kind)
		}
		if body.Title != nil {
			existing.Title = strings.TrimSpace(*body.Title)
		}
		if body.Citation != nil {
			existing.Citation = strings.TrimSpace(*body.Citation)
		}
		if body.URL != nil {
			existing.URL = strings.TrimSpace(*body.URL)
		}
		if body.Date != nil {
			existing.Date = strings.TrimSpace(*body.Date)
		}
		if body.Note != nil {
			existing.Note = strings.TrimSpace(*body.Note)
		}
		if body.EventID != nil {
			existing.EventID = *body.EventID
		}
		if _, err := db.Exec(`UPDATE sources SET kind = ?, title = ?, citation = ?, url = ?,
			date = ?, note = ?, event_id = ? WHERE id = ?`,
			existing.Kind, existing.Title, existing.Citation, existing.URL,
			existing.Date, existing.Note, existing.EventID, id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonResponse(w, existing)

	case http.MethodDelete:
		if _, err := db.Exec("DELETE FROM sources WHERE id = ?", id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// fetchAllSources returns every source in the tree, for a backup.
func fetchAllSources() ([]Source, error) {
	if !tableExists("sources") {
		return []Source{}, nil
	}
	return fetchSources(`SELECT id, person_id, event_id, kind, title, citation,
		url, date, note, created_at FROM sources ORDER BY id`)
}

func fetchSources(query string, args ...interface{}) ([]Source, error) {
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSources(rows), nil
}

func scanSources(rows *sql.Rows) []Source {
	sources := []Source{}
	for rows.Next() {
		var s Source
		if err := rows.Scan(&s.ID, &s.PersonID, &s.EventID, &s.Kind, &s.Title,
			&s.Citation, &s.URL, &s.Date, &s.Note, &s.CreatedAt); err != nil {
			continue
		}
		sources = append(sources, s)
	}
	return sources
}
