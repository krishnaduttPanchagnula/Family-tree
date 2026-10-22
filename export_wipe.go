package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// wipeCounts records what the wipe removed.
type wipeCounts struct {
	Persons       int `json:"persons"`
	Relationships int `json:"relationships"`
	Events        int `json:"events"`
	Sources       int `json:"sources"`
	Media         int `json:"media"`
}

// handleWipe empties the tree. POST /api/wipe
//
// It is the one action that cannot be undone by the undo button, so it needs
// the word DELETE, writes a snapshot first, and only then removes the rows.
func handleWipe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Confirm      string `json:"confirm"`
		DeletePhotos bool   `json:"delete_photos"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(body.Confirm) != "DELETE" {
		http.Error(w, "type DELETE to confirm", http.StatusBadRequest)
		return
	}

	snapshot, err := writeSnapshot()
	if err != nil {
		http.Error(w, "could not write a snapshot before wiping: "+err.Error(), http.StatusInternalServerError)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	counts := wipeCounts{}
	tables := []struct {
		name  string
		count *int
	}{
		{"sources", &counts.Sources},
		{"event_media", &counts.Media},
		{"events", &counts.Events},
		{"relationships", &counts.Relationships},
		{"persons", &counts.Persons},
	}
	for _, table := range tables {
		if !tableExists(table.name) {
			continue
		}
		var n int
		if err := tx.QueryRow("SELECT COUNT(*) FROM " + table.name).Scan(&n); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		*table.count = n
		if _, err := tx.Exec("DELETE FROM " + table.name); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	photosDeleted := 0
	if body.DeletePhotos {
		photosDeleted = deleteUploadFiles()
	}

	jsonResponse(w, map[string]interface{}{
		"snapshot":       snapshot,
		"deleted":        counts,
		"photos_deleted": photosDeleted,
	})
}

// deleteUploadFiles removes the files directly inside the uploads folder.
// Sub-folders and symlinks that point elsewhere are left alone.
func deleteUploadFiles() int {
	dir := uploadsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	deleted := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err == nil {
			deleted++
		}
	}
	return deleted
}
