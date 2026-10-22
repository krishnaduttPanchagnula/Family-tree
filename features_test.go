package main

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// useTempDB points the global database at a throwaway file so the tests never
// touch the real familytree.db.
func useTempDB(t *testing.T) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	conn, err := sql.Open("sqlite3", path+"?_fk=1")
	if err != nil {
		t.Fatalf("could not open the test database: %v", err)
	}
	db = conn
	if err := createSchema(); err != nil {
		t.Fatalf("could not create the schema: %v", err)
	}
	initEventTable()
	t.Cleanup(func() {
		conn.Close()
		db = nil
	})
}

func addPerson(t *testing.T, name, dob string) int {
	t.Helper()
	res, err := db.Exec(`INSERT INTO persons (name, image_url, pos_x, pos_y, dob) VALUES (?, '', 0, 0, ?)`, name, dob)
	if err != nil {
		t.Fatalf("could not add %s: %v", name, err)
	}
	id, _ := res.LastInsertId()
	return int(id)
}

func addRelation(t *testing.T, a, b int, relation string) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO relationships (person1_id, person2_id, relation) VALUES (?, ?, ?)`, a, b, relation); err != nil {
		t.Fatalf("could not link %d and %d: %v", a, b, err)
	}
}

func TestEventCrud(t *testing.T) {
	useTempDB(t)
	person := addPerson(t, "Ada Lovelace", "1815-12-10")

	body := strings.NewReader(`{"person_id":` + itoa(person) + `,"kind":"marriage","date":"1835-07-08","place":"London","title":"Married","note":""}`)
	req := httptest.NewRequest(http.MethodPost, "/api/events", body)
	rec := httptest.NewRecorder()
	handleEvents(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("creating an event returned %d: %s", rec.Code, rec.Body.String())
	}
	var created Event
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("could not read the created event: %v", err)
	}
	if created.ID == 0 || created.Kind != "marriage" {
		t.Fatalf("unexpected event: %+v", created)
	}

	// Listing returns the event.
	req = httptest.NewRequest(http.MethodGet, "/api/events", nil)
	rec = httptest.NewRecorder()
	handleEvents(rec, req)
	var events []Event
	if err := json.Unmarshal(rec.Body.Bytes(), &events); err != nil {
		t.Fatalf("could not read the event list: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected one event, got %d", len(events))
	}

	// An unknown kind falls back to "other".
	req = httptest.NewRequest(http.MethodPost, "/api/events",
		strings.NewReader(`{"person_id":`+itoa(person)+`,"kind":"nonsense"}`))
	rec = httptest.NewRecorder()
	handleEvents(rec, req)
	var fallback Event
	json.Unmarshal(rec.Body.Bytes(), &fallback)
	if fallback.Kind != "other" {
		t.Fatalf("expected an unknown kind to become \"other\", got %q", fallback.Kind)
	}

	// An event for a person who does not exist is rejected.
	req = httptest.NewRequest(http.MethodPost, "/api/events",
		strings.NewReader(`{"person_id":9999,"kind":"birth"}`))
	rec = httptest.NewRecorder()
	handleEvents(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected a 400 for an unknown person, got %d", rec.Code)
	}

	// Deleting removes it.
	req = httptest.NewRequest(http.MethodDelete, "/api/events/"+itoa(created.ID), nil)
	rec = httptest.NewRecorder()
	handleEventByID(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected a 204, got %d", rec.Code)
	}
	events, _ = fetchAllEvents()
	if len(events) != 1 { // only the fallback event is left
		t.Fatalf("expected one event after the delete, got %d", len(events))
	}
}

func TestGedcomRoundTrip(t *testing.T) {
	useTempDB(t)

	ada := addPerson(t, "Ada Lovelace", "1815-12-10")
	william := addPerson(t, "William King", "1816-06-01")
	byron := addPerson(t, "Byron King", "1837-05-10")
	addRelation(t, ada, william, "spouse")
	addRelation(t, ada, byron, "child")

	text, err := exportGEDCOM()
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}
	for _, want := range []string{"0 HEAD", "1 GEDC", "0 @I1@", "1 NAME Ada /Lovelace/", "1 BIRT", "2 DATE 10 DEC 1815", "0 TRLR"} {
		if !strings.Contains(text, want) {
			t.Fatalf("the export is missing %q:\n%s", want, text)
		}
	}

	// Import into a clean tree and check the shape survived.
	useTempDB(t)
	persons, rels, warnings, err := importGEDCOM(text)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}
	if persons != 3 {
		t.Fatalf("expected 3 people, got %d (warnings: %v)", persons, warnings)
	}
	if rels < 2 {
		t.Fatalf("expected at least 2 relationships, got %d", rels)
	}
	imported, _ := fetchAllPersons()
	if len(imported) != 3 {
		t.Fatalf("expected 3 people in the database, got %d", len(imported))
	}
	found := false
	for _, p := range imported {
		if p.Name == "Ada Lovelace" && p.DOB == "1815-12-10" {
			found = true
		}
	}
	if !found {
		t.Fatalf("the imported person lost their name or date: %+v", imported)
	}

	// Importing the same file again must not duplicate the tree.
	_, rels, _, err = importGEDCOM(text)
	if err != nil {
		t.Fatalf("second import failed: %v", err)
	}
	if rels != 0 {
		t.Fatalf("expected the second import to add no relationships, it added %d", rels)
	}
	imported, _ = fetchAllPersons()
	if len(imported) != 3 {
		t.Fatalf("expected the tree to stay at 3 people, got %d", len(imported))
	}
	stored, _ := fetchAllRelationships()
	// A GEDCOM family lists one couple and their children, so the round trip
	// adds the second parent's link to the child as well.
	if len(stored) != 3 {
		t.Fatalf("expected 3 relationships after the round trip, got %d", len(stored))
	}
}

func TestGedcomDateConversions(t *testing.T) {
	cases := map[string]string{
		"1946-03-11": "11 MAR 1946",
		"1946-03":    "MAR 1946",
	}
	for input, want := range cases {
		if got := gedcomDate(input); got != want {
			t.Errorf("gedcomDate(%q) = %q, want %q", input, got, want)
		}
	}
	if got := parseGedcomDate("11 MAR 1946"); got != "1946-03-11" {
		t.Errorf("parseGedcomDate = %q, want 1946-03-11", got)
	}
	if got := parseGedcomDate("ABT 1850"); got != "1850" {
		t.Errorf("parseGedcomDate(ABT 1850) = %q, want 1850", got)
	}
}

func TestGedcomKeepsLifeEvents(t *testing.T) {
	useTempDB(t)
	ada := addPerson(t, "Ada Lovelace", "1815-12-10")
	if _, err := db.Exec(`INSERT INTO events (person_id, kind, date, place, title, note)
		VALUES (?, 'marriage', '1835-07-08', 'London', 'Married', '')`, ada); err != nil {
		t.Fatalf("could not add the event: %v", err)
	}

	text, err := exportGEDCOM()
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}
	if !strings.Contains(text, "1 MARR") || !strings.Contains(text, "2 DATE 8 JUL 1835") {
		t.Fatalf("the export is missing the marriage event:\n%s", text)
	}

	useTempDB(t)
	if _, _, _, err := importGEDCOM(text); err != nil {
		t.Fatalf("import failed: %v", err)
	}
	events, err := fetchAllEvents()
	if err != nil {
		t.Fatalf("could not read the events: %v", err)
	}
	if len(events) != 1 || events[0].Kind != "marriage" || events[0].Place != "London" {
		t.Fatalf("the marriage event did not survive the round trip: %+v", events)
	}
}

func TestBackupArchiveContainsThePhotos(t *testing.T) {
	useTempDB(t)
	dir := t.TempDir()
	// The handler reads ./uploads, so run it from a temporary folder.
	if err := os.MkdirAll(dir+"/uploads", 0755); err != nil {
		t.Fatalf("could not create the uploads folder: %v", err)
	}
	if err := os.WriteFile(dir+"/uploads/photo.jpg", []byte("not really a jpeg"), 0644); err != nil {
		t.Fatalf("could not write the photo: %v", err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("could not read the working directory: %v", err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("could not enter the temporary directory: %v", err)
	}
	defer os.Chdir(cwd)

	addPerson(t, "Ada Lovelace", "1815-12-10")

	req := httptest.NewRequest(http.MethodGet, "/api/backup/archive", nil)
	rec := httptest.NewRecorder()
	handleBackupArchive(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("the archive request returned %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("unexpected content type %q", ct)
	}

	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatalf("the archive is not a zip: %v", err)
	}
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	if !names["family-tree.json"] || !names["uploads/photo.jpg"] || !names["README.txt"] {
		t.Fatalf("the archive is missing files: %v", names)
	}
}

func TestRestoreKeepsLifeEvents(t *testing.T) {
	useTempDB(t)
	ada := addPerson(t, "Ada Lovelace", "1815-12-10")
	if _, err := db.Exec(`INSERT INTO events (person_id, kind, date, place, title, note)
		VALUES (?, 'marriage', '1835-07-08', 'London', 'Married', '')`, ada); err != nil {
		t.Fatalf("could not add the event: %v", err)
	}

	events, err := fetchAllEvents()
	if err != nil || len(events) != 1 {
		t.Fatalf("expected one event, got %d (%v)", len(events), err)
	}
	persons, _ := fetchAllPersons()
	rels, _ := fetchAllRelationships()

	// A restore replaces everything, so the events have to be part of the
	// payload or they would be lost.
	if err := writePayload(backupPayload{
		Version: 1, Persons: persons, Relationships: rels, Events: events,
	}, true); err != nil {
		t.Fatalf("the restore failed: %v", err)
	}
	restored, err := fetchAllEvents()
	if err != nil {
		t.Fatalf("could not read the events: %v", err)
	}
	if len(restored) != 1 || restored[0].Kind != "marriage" || restored[0].Place != "London" {
		t.Fatalf("the events did not survive the restore: %+v", restored)
	}
}

func TestCSVExport(t *testing.T) {
	useTempDB(t)
	ada := addPerson(t, "Ada Lovelace", "1815-12-10")
	william := addPerson(t, "William King", "1816-06-01")
	addRelation(t, ada, william, "spouse")

	req := httptest.NewRequest(http.MethodGet, "/api/export.csv?kind=people", nil)
	rec := httptest.NewRecorder()
	handleCSVExport(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, "name,dob") || !strings.Contains(body, "Ada Lovelace") {
		t.Fatalf("the people CSV looks wrong:\n%s", body)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/export.csv?kind=relationships", nil)
	rec = httptest.NewRecorder()
	handleCSVExport(rec, req)
	body = rec.Body.String()
	if !strings.Contains(body, "spouse") || !strings.Contains(body, "William King") {
		t.Fatalf("the relationships CSV looks wrong:\n%s", body)
	}
}

func TestSnapshotLifecycle(t *testing.T) {
	useTempDB(t)
	dir := t.TempDir()
	old := snapshotDir
	defer func() { snapshotDir = old }()
	snapshotDir = dir

	addPerson(t, "Ada Lovelace", "1815-12-10")
	name, err := writeSnapshot()
	if err != nil {
		t.Fatalf("could not write a snapshot: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
		t.Fatalf("the snapshot file is missing: %v", err)
	}

	// A second snapshot of an unchanged tree reuses the first file.
	again, err := writeSnapshot()
	if err != nil {
		t.Fatalf("could not write the second snapshot: %v", err)
	}
	if again != name {
		t.Fatalf("expected an unchanged tree to keep one snapshot, got %q and %q", name, again)
	}

	list := listSnapshots()
	if len(list) != 1 || list[0].Name != name {
		t.Fatalf("unexpected snapshot list: %+v", list)
	}

	// Reading it back gives a restorable payload.
	req := httptest.NewRequest(http.MethodGet, "/api/snapshots/"+name, nil)
	rec := httptest.NewRecorder()
	handleSnapshotByID(rec, req)
	var payload backupPayload
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("could not read the snapshot: %v", err)
	}
	if len(payload.Persons) != 1 {
		t.Fatalf("expected 1 person in the snapshot, got %d", len(payload.Persons))
	}

	// And it can be deleted.
	req = httptest.NewRequest(http.MethodDelete, "/api/snapshots/"+name, nil)
	rec = httptest.NewRecorder()
	handleSnapshotByID(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected a 204, got %d", rec.Code)
	}
	if len(listSnapshots()) != 0 {
		t.Fatal("the snapshot was not deleted")
	}
}

func TestShareLinkBlocksWrites(t *testing.T) {
	useTempDB(t)

	req := httptest.NewRequest(http.MethodPost, "/api/share", nil)
	rec := httptest.NewRecorder()
	handleShare(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("creating a share link returned %d", rec.Code)
	}
	var state shareState
	if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil {
		t.Fatalf("could not read the share state: %v", err)
	}
	if !state.Enabled || state.Token == "" {
		t.Fatalf("unexpected share state: %+v", state)
	}

	// A request with the share token cannot write.
	req = httptest.NewRequest(http.MethodPost, "/api/persons", strings.NewReader("{}"))
	req = withShareToken(req, state.Token)
	rec = httptest.NewRecorder()
	guardWrite(handlePersons)(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected a 403 for a shared write, got %d", rec.Code)
	}

	// Reading still works.
	req = httptest.NewRequest(http.MethodGet, "/api/persons", nil)
	req = withShareToken(req, state.Token)
	rec = httptest.NewRecorder()
	guardWrite(handlePersons)(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected a shared read to work, got %d", rec.Code)
	}

	// Stopping the link restores writing.
	req = httptest.NewRequest(http.MethodDelete, "/api/share", nil)
	rec = httptest.NewRecorder()
	handleShare(rec, req)

	req = httptest.NewRequest(http.MethodPost, "/api/persons", strings.NewReader("{}"))
	req = withShareToken(req, state.Token)
	rec = httptest.NewRecorder()
	guardWrite(handlePersons)(rec, req)
	if rec.Code == http.StatusForbidden {
		t.Fatal("expected writes to work again after the link was stopped")
	}
}

// itoa keeps the test bodies readable.
func itoa(v int) string {
	return strconv.Itoa(v)
}

// withShareToken returns a request that carries the read-only share token.
func withShareToken(r *http.Request, token string) *http.Request {
	r.URL.RawQuery = "share=" + token
	return r
}
