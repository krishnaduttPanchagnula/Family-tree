package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// snapshotDir holds the automatic local snapshots. They are plain JSON files
// so they can be copied to a USB stick or inspected by hand.
var snapshotDir = "backups"

// snapshotInterval is how often the scheduler writes a snapshot.
const snapshotInterval = 30 * time.Minute

// handleBackupArchive downloads the whole tree as a zip: the data plus every
// uploaded photo, which the plain JSON backup does not contain.
func handleBackupArchive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	persons, err := fetchAllPersons()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	rels, err := fetchAllRelationships()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	events, err := fetchAllEvents()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sources, err := fetchAllSources()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	media, err := fetchAllEventMedia()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	payload := backupPayload{
		Version:       1,
		ExportedAt:    time.Now().UTC().Format(time.RFC3339),
		Persons:       persons,
		Relationships: rels,
		Events:        events,
		Sources:       sources,
		Media:         media,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="family-tree-full-backup-%s.zip"`, time.Now().Format("2006-01-02")))

	zw := zip.NewWriter(w)
	defer zw.Close()

	jsonFile, err := zw.Create("family-tree.json")
	if err == nil {
		jsonFile.Write(data)
	}

	readme, err := zw.Create("README.txt")
	if err == nil {
		readme.Write([]byte(
			"Family Tree Builder - full backup\n\n" +
				"family-tree.json  every person and relationship\n" +
				"uploads/          the photos, exactly as they are stored\n\n" +
				"To restore: open the app, choose Settings > Backup & data >\n" +
				"Restore from backup, and pick family-tree.json from this archive.\n"))
	}

	// Photos: copy the uploads folder into the archive.
	entries, err := os.ReadDir("./uploads")
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			src, err := os.Open(filepath.Join("./uploads", entry.Name()))
			if err != nil {
				continue
			}
			dst, err := zw.Create("uploads/" + entry.Name())
			if err != nil {
				src.Close()
				continue
			}
			io.Copy(dst, src)
			src.Close()
		}
	}
}

// handleCSVExport writes the tree as CSV. ?type=people (default) or
// ?type=relationships.
func handleCSVExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	kind := r.URL.Query().Get("kind")
	if kind == "" {
		kind = r.URL.Query().Get("type")
	}

	var (
		header []string
		rows   [][]string
		name   string
	)

	persons, err := fetchAllPersons()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	switch kind {
	case "relationships":
		rels, err := fetchAllRelationships()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		header = []string{"id", "person1_id", "person1_name", "person2_id", "person2_name", "relation"}
		for _, rel := range rels {
			rows = append(rows, []string{
				strconv.Itoa(rel.ID),
				strconv.Itoa(rel.Person1ID),
				personName(persons, rel.Person1ID),
				strconv.Itoa(rel.Person2ID),
				personName(persons, rel.Person2ID),
				rel.Relation,
			})
		}
		name = "relationships.csv"
	default:
		header = []string{"id", "name", "dob", "dod", "place_of_birth", "profession", "notes", "photo"}
		for _, p := range sortedPersonNames(persons) {
			rows = append(rows, []string{
				strconv.Itoa(p.ID), p.Name, p.DOB, p.DOD, p.BirthCountry, p.Profession, p.Facts, p.ImageURL,
			})
		}
		name = "people.csv"
	}

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)

	cw := csv.NewWriter(w)
	cw.Write(header)
	for _, row := range rows {
		cw.Write(row)
	}
	cw.Flush()
}

func personName(persons []Person, id int) string {
	for _, p := range persons {
		if p.ID == id {
			return p.Name
		}
	}
	return ""
}

// --- Local snapshots ---

// snapshotInfo describes one snapshot file.
type snapshotInfo struct {
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"created_at"`
}

// listSnapshots returns the snapshots on disk, newest first.
func listSnapshots() []snapshotInfo {
	out := []snapshotInfo{}
	entries, err := os.ReadDir(snapshotDir)
	if err != nil {
		return out
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		out = append(out, snapshotInfo{
			Name:      entry.Name(),
			Size:      info.Size(),
			CreatedAt: info.ModTime().UTC().Format(time.RFC3339),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name > out[j].Name })
	return out
}

// writeSnapshot stores the current tree as a snapshot file and returns its
// name. A snapshot that would be identical to the previous one is skipped, so
// an idle tree does not fill the folder with duplicates.
func writeSnapshot() (string, error) {
	persons, err := fetchAllPersons()
	if err != nil {
		return "", err
	}
	rels, err := fetchAllRelationships()
	if err != nil {
		return "", err
	}
	events, err := fetchAllEvents()
	if err != nil {
		return "", err
	}
	sources, err := fetchAllSources()
	if err != nil {
		return "", err
	}
	media, err := fetchAllEventMedia()
	if err != nil {
		return "", err
	}
	payload := backupPayload{
		Version:       1,
		ExportedAt:    time.Now().UTC().Format(time.RFC3339),
		Persons:       persons,
		Relationships: rels,
		Events:        events,
		Sources:       sources,
		Media:         media,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)

	if existing := listSnapshots(); len(existing) > 0 {
		if previous, err := os.ReadFile(filepath.Join(snapshotDir, existing[0].Name)); err == nil {
			prevSum := sha256.Sum256(previous)
			if hex.EncodeToString(prevSum[:]) == hex.EncodeToString(sum[:]) {
				return existing[0].Name, nil
			}
		}
	}

	if err := os.MkdirAll(snapshotDir, os.ModePerm); err != nil {
		return "", err
	}
	name := fmt.Sprintf("snapshot-%s.json", time.Now().Format("20060102-150405"))
	if err := os.WriteFile(filepath.Join(snapshotDir, name), data, 0644); err != nil {
		return "", err
	}
	return name, nil
}

// handleSnapshots lists (GET) the local snapshots.
func handleSnapshots(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	jsonResponse(w, listSnapshots())
}

// handleSnapshotCreate writes a snapshot right now.
func handleSnapshotCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name, err := writeSnapshot()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"name": name, "created_at": time.Now().UTC().Format(time.RFC3339)})
}

// handleSnapshotByID returns one snapshot (GET) or deletes it (DELETE).
func handleSnapshotByID(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.URL.Path, "/api/snapshots/")
	name := strings.Trim(raw, "/")
	if name == "" || strings.Contains(name, "/") || strings.Contains(name, "..") {
		http.Error(w, "invalid snapshot name", http.StatusBadRequest)
		return
	}
	path := filepath.Join(snapshotDir, name)

	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile(path)
		if err != nil {
			http.Error(w, "snapshot not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	case http.MethodDelete:
		if err := os.Remove(path); err != nil {
			http.Error(w, "snapshot not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// startSnapshotScheduler writes a snapshot every 30 minutes while the app is
// running. Everything stays on this machine.
func startSnapshotScheduler() {
	go func() {
		ticker := time.NewTicker(snapshotInterval)
		defer ticker.Stop()
		for range ticker.C {
			if _, err := writeSnapshot(); err != nil {
				log.Printf("snapshot failed: %v", err)
			}
		}
	}()
}
