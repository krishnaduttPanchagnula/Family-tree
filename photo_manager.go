package main

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// PhotoFile is one file in the uploads folder and who uses it.
type PhotoFile struct {
	File     string          `json:"file"`
	URL      string          `json:"url"`
	Size     int64           `json:"size"`
	Modified string          `json:"modified"`
	UsedBy   []PhotoUser     `json:"used_by"`
	EventUse []PhotoEventUse `json:"event_media"`
	Orphan   bool            `json:"orphan"`
}

// PhotoUser is a person that uses a photo.
type PhotoUser struct {
	PersonID int    `json:"person_id"`
	Name     string `json:"name"`
}

// PhotoEventUse is a life event that uses a photo.
type PhotoEventUse struct {
	EventID  int    `json:"event_id"`
	PersonID int    `json:"person_id"`
	Caption  string `json:"caption"`
}

// PhotoTotals summarises the uploads folder.
type PhotoTotals struct {
	Files       int   `json:"files"`
	Bytes       int64 `json:"bytes"`
	Orphans     int   `json:"orphans"`
	OrphanBytes int64 `json:"orphan_bytes"`
}

// uploadsDir is the absolute path of the local photo folder.
func uploadsDir() string {
	abs, err := filepath.Abs("./uploads")
	if err != nil {
		return "./uploads"
	}
	return abs
}

// handlePhotos lists every file in the uploads folder, says who uses it and
// flags the ones nobody uses.
func handlePhotos(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		report, err := listPhotos()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonResponse(w, report)

	case http.MethodDelete:
		name := r.URL.Query().Get("file")
		if !safeFileName(name) {
			http.Error(w, "invalid file name", http.StatusBadRequest)
			return
		}
		force := r.URL.Query().Get("force") == "1"

		users, media, err := photoUsers(name)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(users) > 0 || len(media) > 0 {
			if !force {
				names := make([]string, 0, len(users))
				for _, u := range users {
					names = append(names, u.Name)
				}
				http.Error(w, "this photo is used by "+strings.Join(names, ", ")+
					". Delete it from the person first, or force it.", http.StatusConflict)
				return
			}
			cleared, err := clearPhotoReferences(name)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if err := os.Remove(filepath.Join(uploadsDir(), name)); err != nil && !os.IsNotExist(err) {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			jsonResponse(w, map[string]interface{}{"deleted": true, "cleared": cleared})
			return
		}

		if err := os.Remove(filepath.Join(uploadsDir(), name)); err != nil {
			if os.IsNotExist(err) {
				http.Error(w, "file not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonResponse(w, map[string]interface{}{"deleted": true})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// listPhotos reads the uploads folder and matches every file to the people
// and events that use it.
func listPhotos() (map[string]interface{}, error) {
	dir := uploadsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]interface{}{
				"photos": []PhotoFile{},
				"totals": PhotoTotals{},
			}, nil
		}
		return nil, err
	}

	photos := []PhotoFile{}
	totals := PhotoTotals{}
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		name := entry.Name()
		users, media, err := photoUsers(name)
		if err != nil {
			return nil, err
		}
		orphan := len(users) == 0 && len(media) == 0
		photos = append(photos, PhotoFile{
			File:     name,
			URL:      "/uploads/" + name,
			Size:     info.Size(),
			Modified: info.ModTime().UTC().Format(time.RFC3339),
			UsedBy:   users,
			EventUse: media,
			Orphan:   orphan,
		})
		totals.Files++
		totals.Bytes += info.Size()
		if orphan {
			totals.Orphans++
			totals.OrphanBytes += info.Size()
		}
	}

	// The files nobody uses are the ones worth offering to delete, so they
	// come first.
	sort.SliceStable(photos, func(i, j int) bool {
		if photos[i].Orphan != photos[j].Orphan {
			return photos[i].Orphan
		}
		return photos[i].File < photos[j].File
	})

	return map[string]interface{}{"photos": photos, "totals": totals}, nil
}

// photoUsers finds the people and events that use a file.
func photoUsers(name string) ([]PhotoUser, []PhotoEventUse, error) {
	users := []PhotoUser{}
	media := []PhotoEventUse{}

	persons, err := fetchAllPersons()
	if err != nil {
		return nil, nil, err
	}
	for _, p := range persons {
		if imageRefersTo(p.ImageURL, name) {
			users = append(users, PhotoUser{PersonID: p.ID, Name: p.Name})
		}
	}

	if tableExists("event_media") {
		rows, err := db.Query(`SELECT id, event_id, person_id, kind, file_url, caption, created_at
			FROM event_media`)
		if err != nil {
			return nil, nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id, eventID, personID int
			var kind, fileURL, caption string
			var createdAt string
			if err := rows.Scan(&id, &eventID, &personID, &kind, &fileURL, &caption, &createdAt); err != nil {
				continue
			}
			if imageRefersTo(fileURL, name) {
				media = append(media, PhotoEventUse{EventID: eventID, PersonID: personID, Caption: caption})
			}
		}
	}
	return users, media, nil
}

// imageRefersTo reports whether a stored image path points at a file.
func imageRefersTo(value, name string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	return value == name || value == "/uploads/"+name || strings.HasSuffix(value, "/uploads/"+name)
}

// clearPhotoReferences drops the people and events that point at a file that
// is about to be deleted.
func clearPhotoReferences(name string) (map[string]int, error) {
	cleared := map[string]int{"persons": 0, "media": 0}

	persons, err := fetchAllPersons()
	if err != nil {
		return nil, err
	}
	for _, p := range persons {
		if !imageRefersTo(p.ImageURL, name) {
			continue
		}
		if _, err := db.Exec("UPDATE persons SET image_url = '' WHERE id = ?", p.ID); err != nil {
			return nil, err
		}
		cleared["persons"]++
	}

	if tableExists("event_media") {
		res, err := db.Exec(`DELETE FROM event_media WHERE file_url = ? OR file_url = ?`,
			"/uploads/"+name, name)
		if err != nil {
			return nil, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			cleared["media"] = int(n)
		}
	}
	return cleared, nil
}

// safeFileName keeps a request inside the uploads folder: no directories, no
// parent references, no absolute paths.
func safeFileName(name string) bool {
	if name == "" || name == "." || name == ".." {
		return false
	}
	if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
		return false
	}
	if filepath.Base(name) != name {
		return false
	}
	return true
}
