package main

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// GEDCOM 5.5.1 import/export.
//
// The app stores a family as a flat list of people and a list of directed
// relationships. GEDCOM stores families as "FAM" records that group a couple
// with their children, so the export groups the app's parent -> child edges
// by the couple they belong to, and the import splits the families back out.

// gedcomIndividual is one INDI record.
type gedcomIndividual struct {
	xref       string
	name       string
	sex        string
	birthDate  string
	birthPlac  string
	deathDate  string
	deathPlac  string
	occupation string
	note       string
	photo      string
	fams       []string
	famc       []string
	events     []gedcomEvent
}

// gedcomEvent is a life event that is not a birth or a death.
type gedcomEvent struct {
	kind  string
	date  string
	place string
	title string
	note  string
}

// gedcomFamily is one FAM record.
type gedcomFamily struct {
	xref string
	husb string
	wife string
	chil []string
}

// --- Export ---

// exportGEDCOM renders the whole tree as GEDCOM text.
func exportGEDCOM() (string, error) {
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

	personRef := map[int]string{}
	for i, p := range persons {
		personRef[p.ID] = fmt.Sprintf("I%d", i+1)
	}

	// Spouse partners, so children can be grouped into couples.
	partner := map[int]int{}
	for _, rel := range rels {
		if strings.HasPrefix(rel.Relation, "spouse") {
			if _, ok := partner[rel.Person1ID]; !ok {
				partner[rel.Person1ID] = rel.Person2ID
			}
			if _, ok := partner[rel.Person2ID]; !ok {
				partner[rel.Person2ID] = rel.Person1ID
			}
		}
	}

	// Group the parent -> child edges into families.
	type family struct {
		parents  []int
		children []int
	}
	familyOrder := []string{}
	families := map[string]*family{}
	familyOf := map[int]string{} // child id -> family key
	familyParentOf := map[int]string{}

	for _, rel := range rels {
		if !strings.HasPrefix(rel.Relation, "child") {
			continue
		}
		parent, child := rel.Person1ID, rel.Person2ID
		if _, ok := personRef[parent]; !ok {
			continue
		}
		if _, ok := personRef[child]; !ok {
			continue
		}
		mate := partner[parent]
		key := fmt.Sprintf("%d:%d", parent, mate)
		fam, ok := families[key]
		if !ok {
			fam = &family{parents: []int{parent}}
			if mate != 0 {
				if _, known := personRef[mate]; known {
					fam.parents = append(fam.parents, mate)
				}
			}
			families[key] = fam
			familyOrder = append(familyOrder, key)
		}
		if !containsInt(fam.children, child) {
			fam.children = append(fam.children, child)
		}
		familyOf[child] = key
		familyParentOf[parent] = key
	}

	var b strings.Builder
	b.WriteString("0 HEAD\n")
	b.WriteString("1 SOUR FTB\n")
	b.WriteString("2 NAME Family Tree Builder\n")
	b.WriteString("1 CHAR UTF-8\n")
	b.WriteString("1 GEDC\n")
	b.WriteString("2 VERS 5.5.1\n")
	b.WriteString("1 NAME Family Tree Builder\n")

	for i, p := range persons {
		ref := fmt.Sprintf("I%d", i+1)
		b.WriteString("0 @" + ref + "@\n")
		b.WriteString("1 NAME " + gedcomName(p.Name) + "\n")
		b.WriteString("1 SEX U\n")
		if p.DOB != "" {
			b.WriteString("1 BIRT\n")
			b.WriteString("2 DATE " + gedcomDate(p.DOB) + "\n")
			if p.BirthCountry != "" {
				b.WriteString("2 PLAC " + oneLine(p.BirthCountry) + "\n")
			}
		}
		if p.DOD != "" {
			b.WriteString("1 DEAT\n")
			b.WriteString("2 DATE " + gedcomDate(p.DOD) + "\n")
		}
		if p.Profession != "" {
			b.WriteString("1 OCCU " + oneLine(p.Profession) + "\n")
		}
		for _, ev := range events {
			if ev.PersonID != p.ID || ev.Kind == "birth" || ev.Kind == "death" {
				continue
			}
			b.WriteString("1 " + gedcomEventTag(ev.Kind) + "\n")
			if ev.Date != "" {
				b.WriteString("2 DATE " + gedcomDate(ev.Date) + "\n")
			}
			if ev.Place != "" {
				b.WriteString("2 PLAC " + oneLine(ev.Place) + "\n")
			}
			if ev.Title != "" {
				b.WriteString("2 TITL " + oneLine(ev.Title) + "\n")
			}
			if ev.Note != "" {
				b.WriteString("2 NOTE " + oneLine(ev.Note) + "\n")
			}
		}
		if p.Facts != "" {
			b.WriteString("1 NOTE " + oneLine(p.Facts) + "\n")
		}
		if p.ImageURL != "" {
			b.WriteString("1 _FTURL " + oneLine(p.ImageURL) + "\n")
		}
		if key, ok := familyParentOf[p.ID]; ok {
			_ = key
			for _, famKey := range familyOrder {
				if fam := families[famKey]; containsInt(fam.parents, p.ID) {
					b.WriteString("1 FAMS @F" + strconv.Itoa(indexOf(familyOrder, famKey)+1) + "@\n")
				}
			}
		}
		if key, ok := familyOf[p.ID]; ok {
			b.WriteString("1 FAMC @F" + strconv.Itoa(indexOf(familyOrder, key)+1) + "@\n")
		}
	}

	for i, key := range familyOrder {
		fam := families[key]
		b.WriteString("0 @F" + strconv.Itoa(i+1) + "@\n")
		b.WriteString("1 HUSB @" + personRef[fam.parents[0]] + "@\n")
		if len(fam.parents) > 1 {
			b.WriteString("1 WIFE @" + personRef[fam.parents[1]] + "@\n")
		}
		for _, child := range fam.children {
			b.WriteString("1 CHIL @" + personRef[child] + "@\n")
		}
	}

	b.WriteString("0 TRLR\n")
	return b.String(), nil
}

// gedcomEventTag maps an event kind to a GEDCOM tag. Kinds with no standard
// tag are written as a custom _FTEVENT with the kind as its value, so the
// event survives a round trip.
func gedcomEventTag(kind string) string {
	switch kind {
	case "marriage":
		return "MARR"
	case "divorce":
		return "DIV"
	case "residence":
		return "RESI"
	case "immigration":
		return "IMMI"
	default:
		return "_FTEVENT " + strings.ToUpper(kind)
	}
}

// gedcomEventKind is the reverse of gedcomEventTag.
func gedcomEventKind(tag, value string) string {
	switch tag {
	case "MARR":
		return "marriage"
	case "DIV":
		return "divorce"
	case "RESI":
		return "residence"
	case "IMMI":
		return "immigration"
	case "_FTEVENT":
		return normaliseEventKind(value)
	}
	return ""
}

// gedcomName turns "Ada Lovelace" into "Ada /Lovelace/". A single name stays
// as a given name only.
func gedcomName(name string) string {
	name = strings.TrimSpace(oneLine(name))
	if name == "" {
		return "/ /"
	}
	parts := strings.Fields(name)
	if len(parts) == 1 {
		return parts[0] + " /"
	}
	return strings.Join(parts[:len(parts)-1], " ") + " /" + parts[len(parts)-1] + "/"
}

var gedcomMonths = map[string]string{
	"JAN": "01", "FEB": "02", "MAR": "03", "APR": "04", "MAY": "05",
	"JUN": "06", "JUL": "07", "AUG": "08", "SEP": "09", "OCT": "10",
	"NOV": "11", "DEC": "12",
}

// gedcomMonthName turns "03" or "MAR" into "MAR".
func gedcomMonthName(value string) string {
	v := strings.ToUpper(strings.TrimSpace(value))
	if name, ok := gedcomMonths[v]; ok {
		return name
	}
	if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 12 {
		for name, num := range gedcomMonths {
			if num == fmt.Sprintf("%02d", n) {
				return name
			}
		}
	}
	return ""
}

// gedcomDate converts "1946-03-11" into "11 MAR 1946". Anything it does not
// recognise is passed through unchanged, because the app's date field is
// free-form and losing the text would be worse than keeping it.
func gedcomDate(value string) string {
	value = strings.TrimSpace(value)
	parts := strings.Split(value, "-")
	if len(parts) == 3 && len(parts[0]) == 4 {
		month := gedcomMonthName(parts[1])
		if month == "" {
			return oneLine(value)
		}
		day := strings.TrimPrefix(parts[2], "0")
		if day == "" {
			day = "0"
		}
		return oneLine(day + " " + month + " " + parts[0])
	}
	if len(parts) == 2 && len(parts[0]) == 4 {
		month := gedcomMonthName(parts[1])
		if month == "" {
			return oneLine(value)
		}
		return oneLine(month + " " + parts[0])
	}
	return oneLine(value)
}

// oneLine strips newlines so a value stays inside a single GEDCOM line.
func oneLine(value string) string {
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	return strings.TrimSpace(value)
}

func containsInt(list []int, value int) bool {
	for _, v := range list {
		if v == value {
			return true
		}
	}
	return false
}

func indexOf(list []string, value string) int {
	for i, v := range list {
		if v == value {
			return i
		}
	}
	return 0
}

// --- Import ---

// importGEDCOM parses GEDCOM text and merges it into the tree. People are
// matched by name and date of birth so importing the same file twice does
// not duplicate the tree.
func importGEDCOM(data string) (personCount int, relCount int, warnings []string, err error) {
	individuals, families, parseWarnings := parseGEDCOM(data)
	warnings = append(warnings, parseWarnings...)

	// xref -> person id
	refToPerson := map[string]int{}
	existing, err := fetchAllPersons()
	if err != nil {
		return 0, 0, warnings, err
	}
	byNameDate := map[string]int{}
	for _, p := range existing {
		byNameDate[strings.ToLower(strings.TrimSpace(p.Name))+"|"+p.DOB] = p.ID
	}

	for _, ind := range individuals {
		key := strings.ToLower(strings.TrimSpace(ind.name)) + "|" + ind.birthDate
		id, found := byNameDate[key]
		if !found {
			photo := ind.photo
			res, err := db.Exec(`INSERT INTO persons (name, image_url, pos_x, pos_y, dob, dod, birth_country, profession, facts)
				VALUES (?, ?, 0, 0, ?, ?, ?, ?, ?)`,
				ind.name, photo, ind.birthDate, ind.deathDate, ind.birthPlac, ind.occupation, ind.note)
			if err != nil {
				return personCount, relCount, warnings, err
			}
			newID, err := res.LastInsertId()
			if err != nil {
				return personCount, relCount, warnings, err
			}
			id = int(newID)
			byNameDate[key] = id
			personCount++
		} else {
			// Fill in anything the local record is missing.
			db.Exec(`UPDATE persons SET
				dod = CASE WHEN dod = '' THEN ? ELSE dod END,
				birth_country = CASE WHEN birth_country = '' THEN ? ELSE birth_country END,
				profession = CASE WHEN profession = '' THEN ? ELSE profession END,
				facts = CASE WHEN facts = '' THEN ? ELSE facts END
				WHERE id = ?`, ind.deathDate, ind.birthPlac, ind.occupation, ind.note, id)
		}
		refToPerson[ind.xref] = id

		// Life events, skipping ones that are already stored.
		for _, ev := range ind.events {
			if ev.kind == "" {
				continue
			}
			var existing int
			db.QueryRow(`SELECT COUNT(*) FROM events WHERE person_id = ? AND kind = ? AND date = ?`,
				id, ev.kind, ev.date).Scan(&existing)
			if existing > 0 {
				continue
			}
			db.Exec(`INSERT INTO events (person_id, kind, date, place, title, note) VALUES (?, ?, ?, ?, ?, ?)`,
				id, ev.kind, ev.date, ev.place, ev.title, ev.note)
		}
	}

	// Spouses and children from the family records.
	seen := map[string]bool{}
	addRelation := func(a, b int, relation string) {
		if a <= 0 || b <= 0 || a == b {
			return
		}
		key := fmt.Sprintf("%d:%d:%s", a, b, relation)
		if seen[key] {
			return
		}
		seen[key] = true
		// The link may already be in the tree: importing the same file twice
		// must not double every connection.
		var existing int
		db.QueryRow(`SELECT COUNT(*) FROM relationships
			WHERE person1_id = ? AND person2_id = ? AND relation = ?`, a, b, relation).Scan(&existing)
		if existing > 0 {
			return
		}
		res, err := db.Exec(`INSERT INTO relationships (person1_id, person2_id, relation) VALUES (?, ?, ?)`,
			a, b, relation)
		if err == nil && res != nil {
			relCount++
		}
	}

	for _, fam := range families {
		husb, wife := refToPerson[fam.husb], refToPerson[fam.wife]
		if husb > 0 && wife > 0 {
			addRelation(husb, wife, "spouse")
		}
		for _, childRef := range fam.chil {
			child := refToPerson[childRef]
			if child <= 0 {
				continue
			}
			if husb > 0 {
				addRelation(husb, child, "child")
			}
			if wife > 0 {
				addRelation(wife, child, "child")
			}
		}
	}

	// A person that is only referenced through FAMS/FAMC still deserves a link.
	for _, ind := range individuals {
		id := refToPerson[ind.xref]
		if id <= 0 {
			continue
		}
		for _, famRef := range ind.fams {
			fam, ok := families[famRef]
			if !ok {
				continue
			}
			mate := fam.husb
			if mate == ind.xref {
				mate = fam.wife
			}
			if mate != "" {
				addRelation(id, refToPerson[mate], "spouse")
			}
		}
	}

	return personCount, relCount, warnings, nil
}

// parseGEDCOM reads the line-based GEDCOM structure into individuals and
// families.
func parseGEDCOM(data string) ([]gedcomIndividual, map[string]gedcomFamily, []string) {
	warnings := []string{}
	individuals := []gedcomIndividual{}
	families := map[string]gedcomFamily{}

	curInd := -1             // index into individuals, -1 when the current record is not an INDI
	curFam := gedcomFamily{} // the FAM record being read
	curFamRef := ""          // its xref, empty when the current record is not a FAM
	var inNote, inPhoto bool
	var noteBuf, photoBuf string
	// The tag that owns the current sub-structure (e.g. BIRT inside an INDI).
	context := ""
	// The life event currently being read, if any.
	pendingEvent := (*gedcomEvent)(nil)

	closeRecord := func() {
		if curInd < 0 {
			return
		}
		if inNote {
			individuals[curInd].note = strings.TrimSpace(noteBuf)
		}
		if inPhoto {
			individuals[curInd].photo = strings.TrimSpace(photoBuf)
		}
		if pendingEvent != nil {
			individuals[curInd].events = append(individuals[curInd].events, *pendingEvent)
			pendingEvent = nil
		}
		inNote, inPhoto = false, false
		noteBuf, photoBuf = "", ""
	}

	for _, raw := range strings.Split(data, "\n") {
		line := strings.TrimRight(raw, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		if line[0] < '0' || line[0] > '9' {
			warnings = append(warnings, "skipped a line that does not start with a level number")
			continue
		}
		space := strings.Index(line, " ")
		if space < 0 {
			continue
		}
		level, err := strconv.Atoi(line[:space])
		if err != nil {
			continue
		}
		rest := strings.TrimSpace(line[space+1:])
		tag := rest
		value := ""
		if idx := strings.Index(rest, " "); idx >= 0 {
			tag = rest[:idx]
			value = strings.TrimSpace(rest[idx+1:])
		}

		if level == 0 {
			// Close the record that just ended.
			closeRecord()
			curInd, context = -1, ""
			pendingEvent = nil
			if curFamRef != "" {
				families[curFamRef] = curFam
				curFamRef = ""
			}
			curFam = gedcomFamily{}

			if strings.HasPrefix(tag, "@") && strings.HasSuffix(tag, "@") {
				ref := tag[1 : len(tag)-1]
				switch {
				case strings.HasPrefix(ref, "I"):
					individuals = append(individuals, gedcomIndividual{xref: ref})
					curInd = len(individuals) - 1
				case strings.HasPrefix(ref, "F"):
					curFam = gedcomFamily{xref: ref}
					curFamRef = ref
				}
			}
			continue
		}

		if curInd >= 0 {
			ind := &individuals[curInd]
			switch tag {
			case "NAME":
				ind.name = strings.Join(strings.Fields(strings.ReplaceAll(value, "/", " ")), " ")
			case "SEX":
				ind.sex = value
			case "DATE":
				switch context {
				case "BIRT":
					ind.birthDate = parseGedcomDate(value)
				case "DEAT":
					ind.deathDate = parseGedcomDate(value)
				case "EVENT":
					if pendingEvent != nil {
						pendingEvent.date = parseGedcomDate(value)
					}
				}
			case "PLAC":
				switch context {
				case "BIRT":
					ind.birthPlac = value
				case "DEAT":
					ind.deathPlac = value
				case "EVENT":
					if pendingEvent != nil {
						pendingEvent.place = value
					}
				}
			case "TITL":
				if context == "EVENT" && pendingEvent != nil {
					pendingEvent.title = value
				}
			case "OCCU":
				if level == 1 {
					ind.occupation = value
				}
			case "NOTE":
				if context == "EVENT" && pendingEvent != nil {
					pendingEvent.note = value
				} else {
					inNote = true
					noteBuf = value
				}
			case "_FTURL":
				inPhoto = true
				photoBuf = value
			case "FAMC":
				ind.famc = append(ind.famc, strings.Trim(value, "@"))
			case "FAMS":
				ind.fams = append(ind.fams, strings.Trim(value, "@"))
			case "BIRT":
				context = "BIRT"
			case "DEAT":
				context = "DEAT"
			case "MARR", "DIV", "RESI", "IMMI", "_FTEVENT":
				if level == 1 {
					if kind := gedcomEventKind(tag, value); kind != "" {
						pendingEvent = &gedcomEvent{kind: kind}
						context = "EVENT"
					}
				}
			default:
				if level <= 1 {
					context = ""
				}
			}
			continue
		}

		if curFamRef != "" {
			switch tag {
			case "HUSB":
				curFam.husb = strings.Trim(value, "@")
			case "WIFE":
				curFam.wife = strings.Trim(value, "@")
			case "CHIL":
				curFam.chil = append(curFam.chil, strings.Trim(value, "@"))
			}
		}
	}

	// Close the last record.
	if curFamRef != "" {
		families[curFamRef] = curFam
	}
	closeRecord()

	for _, ind := range individuals {
		if ind.name == "" {
			warnings = append(warnings, "skipped an individual with no name")
		}
	}
	return individuals, families, warnings
}

// parseGedcomDate turns common GEDCOM dates into the app's free-form dates.
func parseGedcomDate(value string) string {
	value = strings.TrimSpace(value)
	upper := strings.ToUpper(value)
	for _, prefix := range []string{"ABT ", "ABOUT ", "EST ", "CAL ", "BEF ", "AFT ", "BET ", "FROM ", "TO "} {
		if strings.HasPrefix(upper, prefix) {
			return strings.TrimSpace(value[len(prefix):])
		}
	}
	fields := strings.Fields(value)
	if len(fields) == 3 {
		day := fields[0]
		month, ok := gedcomMonths[strings.ToUpper(fields[1])]
		if !ok {
			return value
		}
		year := fields[2]
		if n, err := strconv.Atoi(day); err == nil {
			return fmt.Sprintf("%s-%s-%02d", year, month, n)
		}
		return fmt.Sprintf("%s-%s", year, month)
	}
	if len(fields) == 2 {
		if month, ok := gedcomMonths[strings.ToUpper(fields[0])]; ok {
			return fmt.Sprintf("%s-%s", fields[1], month)
		}
	}
	if len(fields) == 1 {
		return fields[0]
	}
	return value
}

// handleGEDCOMExport downloads the tree as a .ged file.
func handleGEDCOMExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	text, err := exportGEDCOM()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/vnd.familysearch.gedcom; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="family-tree.ged"`)
	w.Write([]byte(text))
}

// handleGEDCOMImport merges an uploaded .ged file into the tree.
func handleGEDCOMImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "no file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	data := make([]byte, 0, 1<<20)
	buf := make([]byte, 32*1024)
	for {
		n, err := file.Read(buf)
		data = append(data, buf[:n]...)
		if err != nil {
			break
		}
		if len(data) > 32<<20 {
			http.Error(w, "file is too large", http.StatusBadRequest)
			return
		}
	}

	persons, rels, warnings, err := importGEDCOM(string(data))
	if err != nil {
		http.Error(w, "import failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]interface{}{
		"persons":       persons,
		"relationships": rels,
		"warnings":      warnings,
		"file":          header.Filename,
	})
}

// sortedPersonNames is used by the CSV export to keep the file stable.
func sortedPersonNames(persons []Person) []Person {
	out := append([]Person{}, persons...)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].ID < out[j].ID
	})
	return out
}
