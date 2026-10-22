package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// EventMedia is a photo or a document attached to a life event. A wedding
// photo belongs to the wedding, not to a person in general.
type EventMedia struct {
	ID        int    `json:"id"`
	EventID   int    `json:"event_id"`
	PersonID  int    `json:"person_id"`
	Kind      string `json:"kind"`
	FileURL   string `json:"file_url"`
	Caption   string `json:"caption"`
	CreatedAt string `json:"created_at"`
}

const maxMediaSize = 15 << 20 // 15 MB

func initEventMedia() {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS event_media (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		event_id INTEGER NOT NULL,
		person_id INTEGER NOT NULL,
		kind TEXT DEFAULT 'photo',
		file_url TEXT NOT NULL DEFAULT '',
		caption TEXT DEFAULT '',
		created_at TEXT DEFAULT (datetime('now')),
		FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
		FOREIGN KEY(person_id) REFERENCES persons(id) ON DELETE CASCADE
	)`)
	if err != nil {
		return
	}
	db.Exec(`DELETE FROM event_media WHERE event_id NOT IN (SELECT id FROM events)`)
}

// fetchAllEventMedia returns every attached file, for a backup.
func fetchAllEventMedia() ([]EventMedia, error) {
	media := []EventMedia{}
	if !tableExists("event_media") {
		return media, nil
	}
	rows, err := db.Query(`SELECT id, event_id, person_id, kind, file_url, caption, created_at
		FROM event_media ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m EventMedia
		if err := rows.Scan(&m.ID, &m.EventID, &m.PersonID, &m.Kind, &m.FileURL,
			&m.Caption, &m.CreatedAt); err != nil {
			continue
		}
		media = append(media, m)
	}
	return media, nil
}

// handleEventMedia lists the media of an event, uploads a new file, edits a
// caption and deletes a file. The event id is a query parameter so one path
// serves all of it.
func handleEventMedia(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		eventID, _ := strconv.Atoi(r.URL.Query().Get("event_id"))
		personID, _ := strconv.Atoi(r.URL.Query().Get("person_id"))
		if eventID <= 0 && personID <= 0 {
			http.Error(w, "event_id or person_id is required", http.StatusBadRequest)
			return
		}
		query := `SELECT id, event_id, person_id, kind, file_url, caption, created_at FROM event_media`
		var args []interface{}
		if eventID > 0 {
			query += ` WHERE event_id = ?`
			args = append(args, eventID)
		} else {
			query += ` WHERE person_id = ?`
			args = append(args, personID)
		}
		query += ` ORDER BY id`
		rows, err := db.Query(query, args...)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		media := []EventMedia{}
		for rows.Next() {
			var m EventMedia
			if err := rows.Scan(&m.ID, &m.EventID, &m.PersonID, &m.Kind, &m.FileURL,
				&m.Caption, &m.CreatedAt); err != nil {
				continue
			}
			media = append(media, m)
		}
		jsonResponse(w, media)

	case http.MethodPost:
		if err := r.ParseMultipartForm(maxMediaSize); err != nil {
			http.Error(w, "could not read the upload: "+err.Error(), http.StatusBadRequest)
			return
		}
		eventID, _ := strconv.Atoi(r.FormValue("event_id"))
		if eventID <= 0 {
			http.Error(w, "event_id is required", http.StatusBadRequest)
			return
		}
		var personID int
		if err := db.QueryRow("SELECT person_id FROM events WHERE id = ?", eventID).Scan(&personID); err != nil {
			if err == sql.ErrNoRows {
				http.Error(w, "event does not exist", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "a file is required", http.StatusBadRequest)
			return
		}
		defer file.Close()
		if header.Size == 0 {
			http.Error(w, "the file is empty", http.StatusBadRequest)
			return
		}
		if header.Size > maxMediaSize {
			http.Error(w, "the file is larger than 15 MB", http.StatusBadRequest)
			return
		}
		kind := "photo"
		if !strings.HasPrefix(header.Header.Get("Content-Type"), "image/") {
			if header.Header.Get("Content-Type") != "application/pdf" {
				http.Error(w, "only images and PDF documents can be attached", http.StatusBadRequest)
				return
			}
			kind = "document"
		}

		url, err := uploadImage(file, header)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		res, err := db.Exec(`INSERT INTO event_media (event_id, person_id, kind, file_url, caption)
			VALUES (?, ?, ?, ?, ?)`, eventID, personID, kind, url, strings.TrimSpace(r.FormValue("caption")))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		id, _ := res.LastInsertId()
		jsonResponse(w, EventMedia{
			ID: int(id), EventID: eventID, PersonID: personID, Kind: kind,
			FileURL: url, Caption: strings.TrimSpace(r.FormValue("caption")),
		})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleEventMediaByID edits the caption of a file or deletes it.
func handleEventMediaByID(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.URL.Path, "/api/event-media/")
	id, err := strconv.Atoi(strings.Trim(raw, "/"))
	if err != nil || id <= 0 {
		http.Error(w, "invalid media id", http.StatusBadRequest)
		return
	}

	var existing EventMedia
	err = db.QueryRow(`SELECT id, event_id, person_id, kind, file_url, caption, created_at
		FROM event_media WHERE id = ?`, id).
		Scan(&existing.ID, &existing.EventID, &existing.PersonID, &existing.Kind,
			&existing.FileURL, &existing.Caption, &existing.CreatedAt)
	if err == sql.ErrNoRows {
		http.Error(w, "media not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	switch r.Method {
	case http.MethodPatch:
		var body struct {
			Caption *string `json:"caption"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if body.Caption != nil {
			existing.Caption = strings.TrimSpace(*body.Caption)
		}
		if _, err := db.Exec("UPDATE event_media SET caption = ? WHERE id = ?", existing.Caption, id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonResponse(w, existing)

	case http.MethodDelete:
		// The file stays on disk; the photo manager owns the leftovers.
		if _, err := db.Exec("DELETE FROM event_media WHERE id = ?", id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
