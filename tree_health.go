package main

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// HealthFinding is one problem with the tree, in plain language.
type HealthFinding struct {
	ID        string `json:"id"`
	Category  string `json:"category"`
	Severity  string `json:"severity"`
	Title     string `json:"title"`
	Detail    string `json:"detail"`
	PersonIDs []int  `json:"person_ids"`
	Action    string `json:"action"`
}

// HealthSummary counts the findings by severity.
type HealthSummary struct {
	People     int            `json:"people"`
	Findings   int            `json:"findings"`
	Issues     int            `json:"issues"`
	BySeverity map[string]int `json:"by_severity"`
}

// HealthReport is the whole check-my-tree answer.
type HealthReport struct {
	Generated string          `json:"generated"`
	Summary   HealthSummary   `json:"summary"`
	Findings  []HealthFinding `json:"findings"`
}

// handleTreeHealth checks the tree for the problems that make a family tree
// harder to trust: missing dates, unlinked people, impossible dates and
// people who look like the same person twice.
func handleTreeHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	report, err := computeTreeHealth()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, report)
}

// computeTreeHealth runs every check over the current tree.
func computeTreeHealth() (HealthReport, error) {
	persons, err := fetchAllPersons()
	if err != nil {
		return HealthReport{}, err
	}
	rels, err := fetchAllRelationships()
	if err != nil {
		return HealthReport{}, err
	}

	report := HealthReport{
		Generated: time.Now().UTC().Format(time.RFC3339),
		Findings:  []HealthFinding{},
		Summary:   HealthSummary{People: len(persons), BySeverity: map[string]int{}},
	}
	if len(persons) == 0 {
		return report, nil
	}

	byID := map[int]Person{}
	names := map[int]string{}
	for _, p := range persons {
		byID[p.ID] = p
		names[p.ID] = normaliseName(p.Name)
	}

	linked := map[int]bool{}
	adjacency := map[int][]int{}
	for _, rel := range rels {
		linked[rel.Person1ID] = true
		linked[rel.Person2ID] = true
		adjacency[rel.Person1ID] = append(adjacency[rel.Person1ID], rel.Person2ID)
		adjacency[rel.Person2ID] = append(adjacency[rel.Person2ID], rel.Person1ID)
	}

	// Duplicates: the same name and the same birth date.
	duplicates := map[string][]int{}
	for _, p := range persons {
		if p.DOB == "" {
			continue
		}
		key := names[p.ID] + "|" + p.DOB
		duplicates[key] = append(duplicates[key], p.ID)
	}

	today := time.Now()
	for _, key := range sortedKeys(duplicates) {
		ids := duplicates[key]
		if len(ids) < 2 {
			continue
		}
		sort.Ints(ids)
		report.Findings = append(report.Findings, HealthFinding{
			ID:        "duplicate-" + strconv.Itoa(ids[0]) + "-" + strconv.Itoa(ids[1]),
			Category:  "duplicate",
			Severity:  "error",
			Title:     "Two people look like the same person",
			Detail:    describePeople(byID, ids) + " share a name and a birth date.",
			PersonIDs: ids,
			Action:    "merge",
		})
	}

	// Impossible and impossible-looking dates.
	for _, p := range persons {
		dob, dobOK := parsePartialDate(p.DOB)
		dod, dodOK := parsePartialDate(p.DOD)
		if dobOK && dodOK {
			if comparePartialDates(dob, dod) > 0 {
				report.Findings = append(report.Findings, HealthFinding{
					ID:        "date-order-" + strconv.Itoa(p.ID),
					Category:  "date-order",
					Severity:  "error",
					Title:     "Someone was born after they died",
					Detail:    p.Name + " was born " + p.DOB + " and died " + p.DOD + ".",
					PersonIDs: []int{p.ID},
					Action:    "open",
				})
			}
		}
		if dobOK && dob.year > today.Year() {
			report.Findings = append(report.Findings, HealthFinding{
				ID:        "future-date-" + strconv.Itoa(p.ID),
				Category:  "future-date",
				Severity:  "warning",
				Title:     "A birth date lies in the future",
				Detail:    p.Name + " has the birth date " + p.DOB + ".",
				PersonIDs: []int{p.ID},
				Action:    "open",
			})
		}
		if dodOK && dod.year > today.Year() {
			report.Findings = append(report.Findings, HealthFinding{
				ID:        "future-date-" + strconv.Itoa(p.ID) + "-dod",
				Category:  "future-date",
				Severity:  "warning",
				Title:     "A death date lies in the future",
				Detail:    p.Name + " has the death date " + p.DOD + ".",
				PersonIDs: []int{p.ID},
				Action:    "open",
			})
		}
	}

	// People with no links at all, and people outside the largest group.
	components := connectedComponents(persons, adjacency)
	main := 0
	for i, ids := range components {
		if len(ids) > len(components[main]) {
			main = i
		}
	}
	for i, ids := range components {
		if len(components) > 1 && i == main {
			continue // the main family is not a finding
		}
		for _, id := range ids {
			p := byID[id]
			if !linked[id] {
				report.Findings = append(report.Findings, HealthFinding{
					ID:        "unlinked-" + strconv.Itoa(id),
					Category:  "unlinked",
					Severity:  "warning",
					Title:     "Someone is not connected to anyone",
					Detail:    p.Name + " has no links in the tree yet.",
					PersonIDs: []int{id},
					Action:    "open",
				})
				continue
			}
			if len(components) > 1 {
				report.Findings = append(report.Findings, HealthFinding{
					ID:        "disconnected-" + strconv.Itoa(id),
					Category:  "disconnected",
					Severity:  "warning",
					Title:     "Someone is in a separate family line",
					Detail:    p.Name + " is not connected to the main family.",
					PersonIDs: []int{id},
					Action:    "open",
				})
			}
		}
	}

	// Missing information, grouped so a tree with twenty people without a
	// photo does not produce twenty separate findings.
	var noDates, noPhotos, noPlaces []int
	for _, p := range persons {
		if p.DOB == "" && p.DOD == "" {
			noDates = append(noDates, p.ID)
		}
		if p.ImageURL == "" {
			noPhotos = append(noPhotos, p.ID)
		}
		if p.BirthCountry == "" {
			noPlaces = append(noPlaces, p.ID)
		}
	}
	missing := []HealthFinding{
		groupFinding("missing-dates", "notice", "Nobody has a birth or death date",
			"These people have no dates yet:", byID, noDates, "open"),
		groupFinding("missing-photo", "notice", "Some people have no photo",
			"These people have no photo yet:", byID, noPhotos, "open"),
		groupFinding("missing-birth-place", "notice", "Some people have no birth place",
			"These people have no place of birth yet:", byID, noPlaces, "open"),
	}
	for _, finding := range missing {
		if len(finding.PersonIDs) == 0 {
			continue // an empty group is not a finding
		}
		report.Findings = append(report.Findings, finding)
	}

	sort.SliceStable(report.Findings, func(i, j int) bool {
		return severityRank(report.Findings[i].Severity) < severityRank(report.Findings[j].Severity)
	})

	report.Summary.Findings = len(report.Findings)
	report.Summary.Issues = 0
	for _, f := range report.Findings {
		report.Summary.BySeverity[f.Severity]++
		report.Summary.Issues += len(f.PersonIDs)
	}
	return report, nil
}

// groupFinding builds one finding for a group of people.
func groupFinding(category, severity, title, lead string, byID map[int]Person, ids []int, action string) HealthFinding {
	finding := HealthFinding{
		ID:        category,
		Category:  category,
		Severity:  severity,
		Title:     title,
		PersonIDs: ids,
		Action:    action,
	}
	if len(ids) == 0 {
		// Nothing to report: an empty group is not a finding.
		finding.Severity = ""
		finding.Title = ""
		finding.Detail = ""
		finding.PersonIDs = []int{}
		return finding
	}
	finding.Detail = lead + " " + describePeople(byID, ids) + "."
	return finding
}

// describePeople names up to three people and counts the rest.
func describePeople(byID map[int]Person, ids []int) string {
	names := make([]string, 0, len(ids))
	for _, id := range ids {
		if p, ok := byID[id]; ok {
			names = append(names, p.Name)
		}
	}
	switch {
	case len(names) == 0:
		return ""
	case len(names) == 1:
		return names[0]
	case len(names) == 2:
		return names[0] + " and " + names[1]
	case len(names) == 3:
		return names[0] + ", " + names[1] + " and " + names[2]
	default:
		return names[0] + ", " + names[1] + ", " + names[2] + " and " + strconv.Itoa(len(names)-3) + " others"
	}
}

// connectedComponents groups people into families by their links.
func connectedComponents(persons []Person, adjacency map[int][]int) [][]int {
	seen := map[int]bool{}
	components := [][]int{}
	for _, p := range persons {
		if seen[p.ID] {
			continue
		}
		queue := []int{p.ID}
		seen[p.ID] = true
		group := []int{}
		for len(queue) > 0 {
			id := queue[0]
			queue = queue[1:]
			group = append(group, id)
			for _, next := range adjacency[id] {
				if !seen[next] {
					seen[next] = true
					queue = append(queue, next)
				}
			}
		}
		sort.Ints(group)
		components = append(components, group)
	}
	return components
}

// normaliseName makes two names comparable: lower case, single spaces.
func normaliseName(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), " "))
}

// partialDate is a date with the parts that are known.
type partialDate struct {
	year  int
	month int
	day   int
}

// parsePartialDate reads YYYY, YYYY-MM and YYYY-MM-DD. Anything else is not
// a date the app can reason about.
func parsePartialDate(value string) (partialDate, bool) {
	value = strings.TrimSpace(value)
	if len(value) < 4 {
		return partialDate{}, false
	}
	year, err := strconv.Atoi(value[:4])
	if err != nil || year < 1000 || year > 3000 {
		return partialDate{}, false
	}
	date := partialDate{year: year}
	if len(value) < 7 || value[4] != '-' {
		return date, true
	}
	month, err := strconv.Atoi(value[5:7])
	if err != nil || month < 1 || month > 12 {
		return partialDate{}, false
	}
	date.month = month
	if len(value) < 10 || value[7] != '-' {
		return date, true
	}
	day, err := strconv.Atoi(value[8:10])
	if err != nil || day < 1 || day > 31 {
		return partialDate{}, false
	}
	date.day = day
	return date, true
}

// comparePartialDates orders two dates that may be missing parts. A missing
// part counts as zero, so 1815 is earlier than 1815-06.
func comparePartialDates(a, b partialDate) int {
	if a.year != b.year {
		return a.year - b.year
	}
	if a.month != b.month {
		return a.month - b.month
	}
	return a.day - b.day
}

func severityRank(severity string) int {
	switch severity {
	case "error":
		return 0
	case "warning":
		return 1
	case "notice":
		return 2
	default:
		return 3
	}
}

// sortedKeys keeps the finding order stable between runs.
func sortedKeys(m map[string][]int) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
