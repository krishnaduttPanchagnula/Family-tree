package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The v0.4 modules: sources, merging, the tree check, the photo manager,
// starting fresh, the calendar, the reports and the GEDCOM duplicates.

// useV04DB points the database at a throwaway file with the tables of every
// v0.4 module in place.
func useV04DB(t *testing.T) {
	t.Helper()
	useTempDB(t)
	initSources()
	initEventMedia()
}

// postJSON sends a JSON body to a handler and returns the recorder.
func postJSON(t *testing.T, handler http.HandlerFunc, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	return requestJSON(t, http.MethodPost, handler, path, body)
}

// requestJSON sends any request to a handler and returns the recorder.
func requestJSON(t *testing.T, method string, handler http.HandlerFunc, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

// getJSON sends a GET to a handler and returns the recorder.
func getJSON(t *testing.T, handler http.HandlerFunc, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

func TestSourcesCrud(t *testing.T) {
	useV04DB(t)
	person := addPerson(t, "Ada Lovelace", "1815-12-10")
	other := addPerson(t, "William King", "1800-01-01")

	rec := postJSON(t, handleSources, "/api/sources",
		`{"person_id":`+itoa(person)+`,"kind":"CENSUS","title":"1841 census","citation":"PROB 11"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("creating a source returned %d: %s", rec.Code, rec.Body.String())
	}
	var created Source
	json.NewDecoder(rec.Body).Decode(&created)
	if created.Kind != "census" {
		t.Fatalf("the kind was not normalised: %q", created.Kind)
	}
	if created.ID == 0 {
		t.Fatal("the new source has no id")
	}

	rec = getJSON(t, handleSources, "/api/sources?person_id="+itoa(person))
	var listed []Source
	json.NewDecoder(rec.Body).Decode(&listed)
	if len(listed) != 1 || listed[0].Title != "1841 census" {
		t.Fatalf("the source was not listed: %+v", listed)
	}

	// An unknown person is refused.
	rec = postJSON(t, handleSources, "/api/sources", `{"person_id":9999}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("a source for an unknown person returned %d", rec.Code)
	}

	// A source may point at one of the person's own events only.
	res, _ := db.Exec(`INSERT INTO events (person_id, kind, date) VALUES (?, 'marriage', '1835-07-08')`, other)
	eventID, _ := res.LastInsertId()
	rec = postJSON(t, handleSources, "/api/sources",
		`{"person_id":`+itoa(person)+`,"event_id":`+itoa(int(eventID))+`}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("a source for another person's event returned %d", rec.Code)
	}

	// Editing and deleting.
	rec = requestJSON(t, http.MethodPatch, handleSourceByID, "/api/sources/"+itoa(created.ID), `{"title":"1851 census"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("editing a source returned %d: %s", rec.Code, rec.Body.String())
	}
	rec = requestJSON(t, http.MethodDelete, handleSourceByID, "/api/sources/"+itoa(created.ID), ``)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("deleting a source returned %d", rec.Code)
	}
	rec = getJSON(t, handleSources, "/api/sources?all=1")
	json.NewDecoder(rec.Body).Decode(&listed)
	if len(listed) != 0 {
		t.Fatalf("the source was not deleted: %+v", listed)
	}
}

func TestPersonMerge(t *testing.T) {
	useV04DB(t)
	t.Chdir(t.TempDir()) // the snapshot must not land in the real backups folder

	survivor := addPerson(t, "Ada Lovelace", "1815-12-10")
	other := addPerson(t, "Ada Lovelace", "1815-12-10")
	child := addPerson(t, "Byron King", "1837-05-10")

	addRelation(t, survivor, other, "spouse")
	addRelation(t, survivor, child, "child")
	db.Exec(`INSERT INTO events (person_id, kind, date, place) VALUES (?, 'birth', '1815-12-10', 'London')`, other)
	db.Exec(`INSERT INTO sources (person_id, kind, title) VALUES (?, 'census', '1841 census')`, other)

	rec := postJSON(t, handleMergePersons, "/api/persons/merge",
		`{"survivor_id":`+itoa(survivor)+`,"other_id":`+itoa(other)+`,"fields":{"facts":"The only Ada."}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("merging returned %d: %s", rec.Code, rec.Body.String())
	}
	var result struct {
		Survivor Person     `json:"survivor"`
		Moved    mergeMoved `json:"moved"`
		Snapshot string     `json:"snapshot"`
	}
	json.NewDecoder(rec.Body).Decode(&result)
	if result.Survivor.Facts != "The only Ada." {
		t.Fatalf("the chosen field did not win: %q", result.Survivor.Facts)
	}
	if result.Snapshot == "" {
		t.Fatal("the merge did not write a snapshot")
	}
	if result.Moved.Events != 1 || result.Moved.Sources != 1 {
		t.Fatalf("the events and sources did not move: %+v", result.Moved)
	}

	// The other person is gone, and the link to them did not stay behind.
	var count int
	db.QueryRow("SELECT COUNT(*) FROM persons WHERE id = ?", other).Scan(&count)
	if count != 0 {
		t.Fatal("the merged person is still in the tree")
	}
	db.QueryRow("SELECT COUNT(*) FROM relationships WHERE (person1_id = ? AND person2_id = ?) OR (person1_id = ? AND person2_id = ?)",
		survivor, survivor, survivor, survivor).Scan(&count)
	if count != 0 {
		t.Fatal("a link to itself survived the merge")
	}
	db.QueryRow("SELECT COUNT(*) FROM events WHERE person_id = ?", survivor).Scan(&count)
	if count != 1 {
		t.Fatalf("the event did not move to the survivor: %d", count)
	}
	db.QueryRow("SELECT COUNT(*) FROM sources WHERE person_id = ?", survivor).Scan(&count)
	if count != 1 {
		t.Fatalf("the source did not move to the survivor: %d", count)
	}

	// A person cannot be merged with themselves, and unknown ids are refused.
	rec = postJSON(t, handleMergePersons, "/api/persons/merge",
		`{"survivor_id":`+itoa(survivor)+`,"other_id":`+itoa(survivor)+`}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("merging a person with themselves returned %d", rec.Code)
	}
	rec = postJSON(t, handleMergePersons, "/api/persons/merge",
		`{"survivor_id":`+itoa(survivor)+`,"other_id":9999}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("merging with an unknown person returned %d", rec.Code)
	}
}

func TestTreeHealthFindings(t *testing.T) {
	useV04DB(t)

	ada := addPerson(t, "Ada Lovelace", "1815-12-10")
	adaAgain := addPerson(t, "Ada Lovelace", "1815-12-10")
	addRelation(t, ada, adaAgain, "spouse")
	addPerson(t, "Nobody", "")

	report, err := computeTreeHealth()
	if err != nil {
		t.Fatalf("the tree check failed: %v", err)
	}

	duplicate := 0
	unlinked := 0
	for _, finding := range report.Findings {
		switch finding.Category {
		case "duplicate":
			duplicate++
			if len(finding.PersonIDs) != 2 || finding.PersonIDs[0] != ada || finding.PersonIDs[1] != adaAgain {
				t.Fatalf("the duplicate finding names the wrong people: %+v", finding)
			}
		case "unlinked":
			unlinked++
		}
	}
	if duplicate != 1 {
		t.Fatalf("expected one duplicate finding, got %d", duplicate)
	}
	if unlinked != 1 {
		t.Fatalf("expected one unlinked person, got %d", unlinked)
	}
	if report.Summary.People != 3 {
		t.Fatalf("the summary counted %d people", report.Summary.People)
	}
}

func TestPhotoManager(t *testing.T) {
	useV04DB(t)
	t.Chdir(t.TempDir())
	if err := os.MkdirAll("uploads", 0o755); err != nil {
		t.Fatalf("could not create the uploads folder: %v", err)
	}
	os.WriteFile(filepath.Join("uploads", "used.jpg"), []byte("photo"), 0o644)
	os.WriteFile(filepath.Join("uploads", "orphan.jpg"), []byte("photo"), 0o644)

	person := addPerson(t, "Ada Lovelace", "1815-12-10")
	db.Exec("UPDATE persons SET image_url = '/uploads/used.jpg' WHERE id = ?", person)

	rec := getJSON(t, handlePhotos, "/api/photos")
	if rec.Code != http.StatusOK {
		t.Fatalf("listing the photos returned %d", rec.Code)
	}
	var report struct {
		Photos []PhotoFile `json:"photos"`
		Totals PhotoTotals `json:"totals"`
	}
	json.NewDecoder(rec.Body).Decode(&report)
	if len(report.Photos) != 2 {
		t.Fatalf("expected two files, got %d", len(report.Photos))
	}
	if report.Totals.Orphans != 1 {
		t.Fatalf("expected one unused file, got %d", report.Totals.Orphans)
	}
	for _, photo := range report.Photos {
		if photo.File == "used.jpg" && photo.Orphan {
			t.Fatal("a photo in use was called unused")
		}
	}

	// A file name may not point outside the uploads folder.
	rec = requestJSON(t, http.MethodDelete, handlePhotos, "/api/photos?file=../secret", ``)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("a path outside the uploads folder returned %d", rec.Code)
	}

	// A photo in use needs the force flag.
	req := httptest.NewRequest(http.MethodDelete, "/api/photos?file=used.jpg", nil)
	rec = httptest.NewRecorder()
	handlePhotos(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("deleting a photo in use returned %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/photos?file=used.jpg&force=1", nil)
	rec = httptest.NewRecorder()
	handlePhotos(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("forcing the delete returned %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join("uploads", "used.jpg")); !os.IsNotExist(err) {
		t.Fatal("the file is still on disk")
	}
	var imageURL string
	db.QueryRow("SELECT image_url FROM persons WHERE id = ?", person).Scan(&imageURL)
	if imageURL != "" {
		t.Fatalf("the person still points at the deleted photo: %q", imageURL)
	}
}

func TestExportWipe(t *testing.T) {
	useV04DB(t)
	t.Chdir(t.TempDir())
	if err := os.MkdirAll("uploads", 0o755); err != nil {
		t.Fatalf("could not create the uploads folder: %v", err)
	}
	os.WriteFile(filepath.Join("uploads", "keep.jpg"), []byte("photo"), 0o644)

	person := addPerson(t, "Ada Lovelace", "1815-12-10")
	addRelation(t, person, addPerson(t, "William King", "1816-06-01"), "spouse")
	db.Exec(`INSERT INTO events (person_id, kind, date) VALUES (?, 'birth', '1815-12-10')`, person)
	db.Exec(`INSERT INTO sources (person_id, kind, title) VALUES (?, 'census', '1841 census')`, person)

	// Without the word DELETE nothing happens.
	rec := postJSON(t, handleWipe, "/api/wipe", `{"confirm":"delete"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("wiping without the confirmation returned %d", rec.Code)
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM persons").Scan(&count)
	if count != 2 {
		t.Fatalf("the tree was changed by a refused wipe: %d people", count)
	}

	rec = postJSON(t, handleWipe, "/api/wipe", `{"confirm":"DELETE"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("the wipe returned %d: %s", rec.Code, rec.Body.String())
	}
	var result struct {
		Snapshot string     `json:"snapshot"`
		Deleted  wipeCounts `json:"deleted"`
	}
	json.NewDecoder(rec.Body).Decode(&result)
	if result.Snapshot == "" {
		t.Fatal("the wipe did not write a snapshot")
	}
	if result.Deleted.Persons != 2 {
		t.Fatalf("the wipe counted %d people", result.Deleted.Persons)
	}
	for _, table := range []string{"persons", "relationships", "events", "sources"} {
		db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count)
		if count != 0 {
			t.Fatalf("the %s table still has %d rows", table, count)
		}
	}
	if _, err := os.Stat(filepath.Join("uploads", "keep.jpg")); err != nil {
		t.Fatal("the photos were deleted even though the box was left unchecked")
	}
}

func TestCalendarMonth(t *testing.T) {
	useV04DB(t)
	person := addPerson(t, "Ada Lovelace", "1990-10-05")
	addPerson(t, "Jo Bloggs", "1990-10")
	db.Exec(`INSERT INTO events (person_id, kind, date, place) VALUES (?, 'marriage', '2010-10-09', 'London')`, person)

	rec := getJSON(t, handleCalendar, "/api/calendar?month=2026-10")
	if rec.Code != http.StatusOK {
		t.Fatalf("the calendar returned %d: %s", rec.Code, rec.Body.String())
	}
	var month CalendarMonth
	json.NewDecoder(rec.Body).Decode(&month)
	if len(month.Birthdays) != 1 || month.Birthdays[0].Day != 5 {
		t.Fatalf("the birthday is missing: %+v", month.Birthdays)
	}
	if month.Birthdays[0].Age != 36 {
		t.Fatalf("the age is wrong: %d", month.Birthdays[0].Age)
	}
	if len(month.Anniversaries) != 1 || month.Anniversaries[0].Years != 16 {
		t.Fatalf("the anniversary is missing: %+v", month.Anniversaries)
	}
	if len(month.Incomplete) != 1 {
		t.Fatalf("the date with only a month was not reported: %+v", month.Incomplete)
	}

	rec = getJSON(t, handleCalendar, "/api/calendar?month=nonsense")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("a bad month returned %d", rec.Code)
	}
}

func TestReports(t *testing.T) {
	useV04DB(t)
	parent := addPerson(t, "William King", "1816-06-01")
	child := addPerson(t, "Byron King", "1837-05-10")
	addRelation(t, parent, child, "child")
	db.Exec(`INSERT INTO sources (person_id, kind, title, citation) VALUES (?, 'census', '1841 census', 'PROB 11')`, parent)

	rec := getJSON(t, handleReport, "/api/reports/ancestor?root="+itoa(child)+"&gens=1")
	if rec.Code != http.StatusOK {
		t.Fatalf("the ancestor report returned %d: %s", rec.Code, rec.Body.String())
	}
	var report Report
	json.NewDecoder(rec.Body).Decode(&report)
	if len(report.Sections) != 1 {
		t.Fatalf("expected one generation, got %d", len(report.Sections))
	}
	if len(report.Sections[0].People) != 1 || report.Sections[0].People[0].ID != parent {
		t.Fatalf("the parent is missing: %+v", report.Sections[0].People)
	}
	if len(report.Sections[0].People[0].Sources) != 1 {
		t.Fatal("the source of the parent is missing")
	}

	rec = getJSON(t, handleReport, "/api/reports/ancestor?root="+itoa(child)+"&gens=0")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("gens=0 returned %d", rec.Code)
	}
	rec = getJSON(t, handleReport, "/api/reports/nonsense")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("an unknown report returned %d", rec.Code)
	}
}

func TestGedcomDuplicateDetection(t *testing.T) {
	useV04DB(t)
	addPerson(t, "Ada Lovelace", "1815-12-10")

	text := "0 HEAD\n1 GEDC\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Ada /Lovelace/\n1 BIRT\n2 DATE 10 DEC 1815\n0 TRLR\n"

	run := &gedcomImport{}
	persons, _, _, err := run.run(text)
	if err != nil {
		t.Fatalf("the import failed: %v", err)
	}
	if persons != 0 {
		t.Fatalf("the import added %d people, it should have reused the existing one", persons)
	}
	if len(run.duplicates) != 1 || run.duplicates[0].Severity != "duplicate" {
		t.Fatalf("the duplicate was not reported: %+v", run.duplicates)
	}
	if run.skipped != 1 {
		t.Fatalf("the import skipped %d people", run.skipped)
	}

	// With the override the file is imported as a separate copy.
	run = &gedcomImport{allowDuplicates: true}
	persons, _, _, err = run.run(text)
	if err != nil {
		t.Fatalf("the second import failed: %v", err)
	}
	if persons != 1 {
		t.Fatalf("the override imported %d people", persons)
	}
}
