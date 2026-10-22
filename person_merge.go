package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// mergeFields are the person fields a merge can resolve. The order is the
// order the dialog shows them.
var mergeFields = []string{"name", "dob", "dod", "birth_country", "profession", "facts", "image_url"}

// mergeMoved counts what moved from one person to the other.
type mergeMoved struct {
	Relationships int `json:"relationships"`
	Events        int `json:"events"`
	Sources       int `json:"sources"`
	Media         int `json:"media"`
}

// handleMergePersons merges two people into one. POST /api/persons/merge
//
// The merge is destructive, so it writes a snapshot first and runs in a single
// transaction: either the survivor has everything, or nothing changed.
func handleMergePersons(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		SurvivorID int               `json:"survivor_id"`
		OtherID    int               `json:"other_id"`
		Fields     map[string]string `json:"fields"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if body.SurvivorID <= 0 || body.OtherID <= 0 {
		http.Error(w, "survivor_id and other_id are required", http.StatusBadRequest)
		return
	}
	if body.SurvivorID == body.OtherID {
		http.Error(w, "a person cannot be merged with themselves", http.StatusBadRequest)
		return
	}

	survivor, err := fetchPerson(body.SurvivorID)
	if err == sql.ErrNoRows {
		http.Error(w, "survivor does not exist", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	other, err := fetchPerson(body.OtherID)
	if err == sql.ErrNoRows {
		http.Error(w, "the other person does not exist", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	snapshot, err := writeSnapshot()
	if err != nil {
		http.Error(w, "could not write a snapshot before merging: "+err.Error(), http.StatusInternalServerError)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	merged := resolveMergeFields(survivor, other, body.Fields)
	if _, err := tx.Exec(`UPDATE persons SET name = ?, dob = ?, dod = ?, birth_country = ?,
		profession = ?, facts = ?, image_url = ? WHERE id = ?`,
		merged.Name, merged.DOB, merged.DOD, merged.BirthCountry, merged.Profession,
		merged.Facts, merged.ImageURL, merged.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	moved, err := movePersonRows(tx, body.OtherID, body.SurvivorID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := tx.Exec("DELETE FROM persons WHERE id = ?", body.OtherID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]interface{}{
		"survivor": merged,
		"moved":    moved,
		"snapshot": snapshot,
	})
}

// resolveMergeFields decides the value of every field. An explicit choice
// wins, then the survivor's own value, then the other person's.
func resolveMergeFields(survivor, other Person, chosen map[string]string) Person {
	pick := func(field, mine, theirs string) string {
		if value, ok := chosen[field]; ok {
			return strings.TrimSpace(value)
		}
		if strings.TrimSpace(mine) != "" {
			return mine
		}
		return theirs
	}
	return Person{
		ID:           survivor.ID,
		Name:         pick("name", survivor.Name, other.Name),
		ImageURL:     pick("image_url", survivor.ImageURL, other.ImageURL),
		PosX:         survivor.PosX,
		PosY:         survivor.PosY,
		DOB:          pick("dob", survivor.DOB, other.DOB),
		DOD:          pick("dod", survivor.DOD, other.DOD),
		BirthCountry: pick("birth_country", survivor.BirthCountry, other.BirthCountry),
		Profession:   pick("profession", survivor.Profession, other.Profession),
		Facts:        pick("facts", survivor.Facts, other.Facts),
	}
}

// movePersonRows repoints everything that belonged to the other person and
// drops the duplicates the merge would otherwise create.
func movePersonRows(tx *sql.Tx, otherID, survivorID int) (mergeMoved, error) {
	var moved mergeMoved

	res, err := tx.Exec("UPDATE relationships SET person1_id = ? WHERE person1_id = ?", survivorID, otherID)
	if err != nil {
		return moved, err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		moved.Relationships += int(n)
	}
	res, err = tx.Exec("UPDATE relationships SET person2_id = ? WHERE person2_id = ?", survivorID, otherID)
	if err != nil {
		return moved, err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		moved.Relationships += int(n)
	}

	// A link to yourself is meaningless, and a link the survivor already has
	// is now a duplicate.
	if _, err := tx.Exec("DELETE FROM relationships WHERE person1_id = ? AND person2_id = ?",
		survivorID, survivorID); err != nil {
		return moved, err
	}
	if _, err := tx.Exec(`DELETE FROM relationships
		WHERE id NOT IN (SELECT MIN(id) FROM relationships GROUP BY person1_id, person2_id, relation)
		AND (person1_id = ? OR person2_id = ?)`, survivorID, survivorID); err != nil {
		return moved, err
	}
	// A spouse link is stored either way round; keep only one of the two.
	if _, err := tx.Exec(`DELETE FROM relationships WHERE relation = 'spouse'
		AND (person1_id = ? OR person2_id = ?)
		AND id > (SELECT MIN(r2.id) FROM relationships r2
			WHERE r2.relation = 'spouse'
			AND ((r2.person1_id = relationships.person2_id AND r2.person2_id = relationships.person1_id)
				OR (r2.person1_id = relationships.person1_id AND r2.person2_id = relationships.person2_id)))`,
		survivorID, survivorID); err != nil {
		return moved, err
	}

	res, err = tx.Exec("UPDATE events SET person_id = ? WHERE person_id = ?", survivorID, otherID)
	if err != nil {
		return moved, err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		moved.Events = int(n)
	}
	if _, err := tx.Exec(`DELETE FROM events WHERE id NOT IN
		(SELECT MIN(id) FROM events GROUP BY person_id, kind, date, place, title, note)
		AND person_id = ?`, survivorID); err != nil {
		return moved, err
	}

	if tableExists("sources") {
		res, err = tx.Exec("UPDATE sources SET person_id = ? WHERE person_id = ?", survivorID, otherID)
		if err != nil {
			return moved, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			moved.Sources = int(n)
		}
	}
	if tableExists("event_media") {
		res, err = tx.Exec("UPDATE event_media SET person_id = ? WHERE person_id = ?", survivorID, otherID)
		if err != nil {
			return moved, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			moved.Media = int(n)
		}
	}

	return moved, nil
}

// fetchPerson reads one person by id.
func fetchPerson(id int) (Person, error) {
	var p Person
	err := db.QueryRow(`SELECT id, name, image_url, pos_x, pos_y, dob, dod,
		birth_country, profession, facts FROM persons WHERE id = ?`, id).
		Scan(&p.ID, &p.Name, &p.ImageURL, &p.PosX, &p.PosY, &p.DOB, &p.DOD,
			&p.BirthCountry, &p.Profession, &p.Facts)
	return p, err
}

// mergePersonIDs reads two ids from the query string, for the shared view.
func mergePersonIDs(r *http.Request) (int, int, bool) {
	survivor, _ := strconv.Atoi(r.URL.Query().Get("survivor_id"))
	other, _ := strconv.Atoi(r.URL.Query().Get("other_id"))
	return survivor, other, survivor > 0 && other > 0 && survivor != other
}
