package main

import (
	"database/sql"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ReportEvent is one life event in a report.
type ReportEvent struct {
	Kind  string `json:"kind"`
	Date  string `json:"date"`
	Place string `json:"place"`
	Title string `json:"title"`
	Note  string `json:"note"`
}

// ReportPerson is one person in a report.
type ReportPerson struct {
	ID         int           `json:"id"`
	Name       string        `json:"name"`
	Dates      string        `json:"dates"`
	BirthPlace string        `json:"birth_place"`
	Profession string        `json:"profession"`
	Facts      string        `json:"facts"`
	Events     []ReportEvent `json:"events"`
	Sources    []Source      `json:"sources"`
}

// ReportSection is one generation or one group in a report.
type ReportSection struct {
	Heading  string         `json:"heading"`
	Subtitle string         `json:"subtitle"`
	People   []ReportPerson `json:"people"`
}

// Report is a printable document about the family.
type Report struct {
	Kind      string          `json:"kind"`
	Title     string          `json:"title"`
	Generated string          `json:"generated"`
	Notice    string          `json:"notice"`
	Sections  []ReportSection `json:"sections"`
}

// handleReport builds one of the printable reports.
// GET /api/reports/{kind}?root=<id>&gens=<n>
func handleReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	kind := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/reports/"), "/")
	switch kind {
	case "ancestor", "descendant", "missing", "sources":
	default:
		http.Error(w, "unknown report", http.StatusNotFound)
		return
	}

	gens := 4
	if raw := r.URL.Query().Get("gens"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 12 {
			http.Error(w, "gens must be between 1 and 12", http.StatusBadRequest)
			return
		}
		gens = n
	}

	report := Report{
		Kind:      kind,
		Generated: time.Now().UTC().Format(time.RFC3339),
		Sections:  []ReportSection{},
	}

	switch kind {
	case "ancestor", "descendant":
		rootID, _ := strconv.Atoi(r.URL.Query().Get("root"))
		if rootID <= 0 {
			http.Error(w, "root is required", http.StatusBadRequest)
			return
		}
		root, err := fetchPerson(rootID)
		if err == sql.ErrNoRows {
			http.Error(w, "person does not exist", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		report.Title = map[bool]string{true: "Ancestors of ", false: "Descendants of "}[kind == "ancestor"] + root.Name
		sections, err := buildFamilyReport(kind, root, gens)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		report.Sections = sections

	case "missing":
		report.Title = "Missing information"
		health, err := computeTreeHealth()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		report.Sections = healthSections(health)

	case "sources":
		report.Title = "Sources"
		sections, notice, err := sourceSections()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		report.Sections = sections
		report.Notice = notice
	}

	jsonResponse(w, report)
}

// buildFamilyReport walks the tree up or down from one person.
func buildFamilyReport(kind string, root Person, gens int) ([]ReportSection, error) {
	persons, err := fetchAllPersons()
	if err != nil {
		return nil, err
	}
	rels, err := fetchAllRelationships()
	if err != nil {
		return nil, err
	}
	events, err := fetchAllEvents()
	if err != nil {
		return nil, err
	}

	byID := map[int]Person{}
	for _, p := range persons {
		byID[p.ID] = p
	}
	eventsByPerson := map[int][]ReportEvent{}
	for _, ev := range events {
		eventsByPerson[ev.PersonID] = append(eventsByPerson[ev.PersonID], ReportEvent{
			Kind: ev.Kind, Date: ev.Date, Place: ev.Place, Title: ev.Title, Note: ev.Note,
		})
	}
	sourcesByPerson := map[int][]Source{}
	if tableExists("sources") {
		sources, err := fetchSources(`SELECT id, person_id, event_id, kind, title, citation,
			url, date, note, created_at FROM sources ORDER BY id`)
		if err != nil {
			return nil, err
		}
		for _, s := range sources {
			sourcesByPerson[s.PersonID] = append(sourcesByPerson[s.PersonID], s)
		}
	}

	parents := map[int][]int{}
	children := map[int][]int{}
	spouses := map[int][]int{}
	for _, rel := range rels {
		parent, child, ok := parentChildEdge(rel)
		if ok {
			parents[child] = append(parents[child], parent)
			children[parent] = append(children[parent], child)
			continue
		}
		if strings.ToLower(strings.TrimSpace(rel.Relation)) == "spouse" {
			spouses[rel.Person1ID] = append(spouses[rel.Person1ID], rel.Person2ID)
			spouses[rel.Person2ID] = append(spouses[rel.Person2ID], rel.Person1ID)
		}
	}

	sections := []ReportSection{}
	seen := map[int]bool{root.ID: true}
	current := []int{root.ID}

	for generation := 1; generation <= gens && len(current) > 0; generation++ {
		var next []int
		for _, id := range current {
			neighbours := children[id]
			if kind == "ancestor" {
				neighbours = parents[id]
			}
			for _, other := range neighbours {
				if seen[other] {
					continue
				}
				seen[other] = true
				next = append(next, other)
			}
		}
		if len(next) == 0 {
			break
		}
		sort.Ints(next)

		// The partners of this generation belong in the same section.
		ids := append([]int{}, next...)
		for _, id := range next {
			for _, spouse := range spouses[id] {
				if !seen[spouse] {
					seen[spouse] = true
					ids = append(ids, spouse)
				}
			}
		}
		sort.Ints(ids)

		people := []ReportPerson{}
		for _, id := range ids {
			p, ok := byID[id]
			if !ok {
				continue
			}
			people = append(people, ReportPerson{
				ID:         p.ID,
				Name:       p.Name,
				Dates:      datesLabel(p),
				BirthPlace: p.BirthCountry,
				Profession: p.Profession,
				Facts:      p.Facts,
				Events:     eventsByPerson[id],
				Sources:    sourcesByPerson[id],
			})
		}
		sections = append(sections, ReportSection{
			Heading:  generationHeading(kind, generation),
			Subtitle: "Generation " + strconv.Itoa(generation),
			People:   people,
		})
		current = next
	}

	return sections, nil
}

// healthSections turns the tree-health findings into report sections.
func healthSections(health HealthReport) []ReportSection {
	byCategory := map[string][]HealthFinding{}
	for _, finding := range health.Findings {
		byCategory[finding.Category] = append(byCategory[finding.Category], finding)
	}
	categories := make([]string, 0, len(byCategory))
	for category := range byCategory {
		categories = append(categories, category)
	}
	sort.Strings(categories)

	sections := []ReportSection{}
	for _, category := range categories {
		findings := byCategory[category]
		people := []ReportPerson{}
		seen := map[int]bool{}
		for _, finding := range findings {
			for _, id := range finding.PersonIDs {
				if seen[id] {
					continue
				}
				seen[id] = true
				person, err := fetchPerson(id)
				if err != nil {
					continue
				}
				people = append(people, ReportPerson{
					ID: person.ID, Name: person.Name, Dates: datesLabel(person),
					BirthPlace: person.BirthCountry, Profession: person.Profession, Facts: person.Facts,
				})
			}
		}
		if len(people) == 0 {
			continue
		}
		sections = append(sections, ReportSection{
			Heading:  findings[0].Title,
			Subtitle: findings[0].Detail,
			People:   people,
		})
	}
	return sections
}

// sourceSections lists the people who have sources.
func sourceSections() ([]ReportSection, string, error) {
	if !tableExists("sources") {
		return []ReportSection{}, "This build has no sources yet.", nil
	}
	sources, err := fetchSources(`SELECT id, person_id, event_id, kind, title, citation,
		url, date, note, created_at FROM sources ORDER BY person_id, id`)
	if err != nil {
		return nil, "", err
	}
	byPerson := map[int][]Source{}
	for _, s := range sources {
		byPerson[s.PersonID] = append(byPerson[s.PersonID], s)
	}
	ids := make([]int, 0, len(byPerson))
	for id := range byPerson {
		ids = append(ids, id)
	}
	sort.Ints(ids)

	sections := []ReportSection{}
	for _, id := range ids {
		person, err := fetchPerson(id)
		if err != nil {
			continue
		}
		sections = append(sections, ReportSection{
			Heading:  person.Name,
			Subtitle: datesLabel(person),
			People: []ReportPerson{{
				ID: person.ID, Name: person.Name, Dates: datesLabel(person),
				BirthPlace: person.BirthCountry, Profession: person.Profession, Facts: person.Facts,
				Sources: byPerson[id],
			}},
		})
	}
	return sections, "", nil
}

// parentChildEdge reads a relationship as a parent and a child. The app
// stores parent -> child as "child", and older imports use father/mother.
func parentChildEdge(rel Relationship) (int, int, bool) {
	relation := strings.ToLower(strings.TrimSpace(rel.Relation))
	switch {
	case relation == "child-of" || relation == "child_of" || relation == "son" || relation == "daughter":
		return rel.Person2ID, rel.Person1ID, true
	case relation == "child" || strings.HasPrefix(relation, "child-") ||
		relation == "father" || relation == "mother" || relation == "parent" ||
		relation == "parent-of" || relation == "parent_of" ||
		relation == "father-of" || relation == "mother-of":
		return rel.Person1ID, rel.Person2ID, true
	}
	return 0, 0, false
}

// generationHeading names a generation in a report.
func generationHeading(kind string, generation int) string {
	if kind == "ancestor" {
		switch generation {
		case 1:
			return "Parents"
		case 2:
			return "Grandparents"
		case 3:
			return "Great-grandparents"
		}
		return "Ancestors"
	}
	switch generation {
	case 1:
		return "Children"
	case 2:
		return "Grandchildren"
	case 3:
		return "Great-grandchildren"
	}
	return "Descendants"
}

// datesLabel is the "1815 – 1852" line of a report.
func datesLabel(p Person) string {
	switch {
	case p.DOB != "" && p.DOD != "":
		return p.DOB + " – " + p.DOD
	case p.DOB != "":
		return "b. " + p.DOB
	case p.DOD != "":
		return "d. " + p.DOD
	}
	return ""
}
