package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The frontend is plain HTML/CSS/JS with no build step, so the only thing
// keeping it consistent is the contract between the ids in index.html and the
// ones app.js looks up. A renamed or removed id would silently break a
// feature at runtime, so it is checked here instead.

func readWebFile(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile("web/" + name)
	if err != nil {
		t.Fatalf("could not read web/%s: %v", name, err)
	}
	return string(data)
}

func TestGetElementByIdTargetsExistInMarkup(t *testing.T) {
	html := readWebFile(t, "index.html")
	js := readWebFile(t, "app.js")

	ids := map[string]bool{}
	for _, m := range regexp.MustCompile(`\bid="([^"]+)"`).FindAllStringSubmatch(html, -1) {
		ids[m[1]] = true
	}

	pattern := regexp.MustCompile(`getElementById\(\s*['"]([^'"]+)['"]`)
	for _, m := range pattern.FindAllStringSubmatch(js, -1) {
		if !ids[m[1]] {
			t.Errorf("app.js looks up #%q but index.html has no element with that id", m[1])
		}
	}
}

func TestIconSpriteSymbolsAreDefined(t *testing.T) {
	html := readWebFile(t, "index.html")

	symbols := map[string]bool{}
	for _, m := range regexp.MustCompile(`<symbol\s+id="([^"]+)"`).FindAllStringSubmatch(html, -1) {
		symbols[m[1]] = true
	}
	if len(symbols) == 0 {
		t.Fatal("no <symbol> elements found in the icon sprite")
	}

	// Only literal icon ids are checked; a module may build one at runtime.
	used := regexp.MustCompile(`href="#(i-[A-Za-z0-9-]+)"`)
	for _, m := range used.FindAllStringSubmatch(html, -1) {
		if !symbols[m[1]] {
			t.Errorf("index.html uses icon #%q but the sprite does not define it", m[1])
		}
	}

	// Every script, including the feature modules, may only use icons that
	// the shared sprite defines.
	scripts, err := filepath.Glob("web/*.js")
	if err != nil {
		t.Fatalf("could not list the web scripts: %v", err)
	}
	for _, script := range scripts {
		body := readWebFile(t, strings.TrimPrefix(script, "web/"))
		for _, m := range used.FindAllStringSubmatch(body, -1) {
			if !symbols[m[1]] {
				t.Errorf("%s uses icon #%q but the sprite does not define it", script, m[1])
			}
		}
	}
}

// Every theme must define the same colour tokens, otherwise a token that only
// exists in one theme silently falls back to another theme's colour.
func TestThemesDefineTheSameTokens(t *testing.T) {
	css := readWebFile(t, "style.css")

	// Tokens that are deliberately theme-independent.
	notThemed := map[string]bool{
		"--radius":       true,
		"--radius-lg":    true,
		"--font-display": true,
	}

	token := regexp.MustCompile(`(--[a-z0-9-]+)\s*:`)
	base := map[string]bool{}
	rootEnd := strings.Index(css, "body[data-theme=")
	if rootEnd < 0 {
		t.Fatal("no theme blocks found in style.css")
	}
	for _, m := range token.FindAllStringSubmatch(css[:rootEnd], -1) {
		base[m[1]] = true
	}

	blocks := regexp.MustCompile(`(?s)body\[data-theme="([a-z]+)"\]\s*\{(.*?)\n\}`).FindAllStringSubmatch(css, -1)
	if len(blocks) == 0 {
		t.Fatal("no theme blocks found in style.css")
	}

	for _, block := range blocks {
		theme, body := block[1], block[2]
		defined := map[string]bool{}
		for _, m := range token.FindAllStringSubmatch(body, -1) {
			defined[m[1]] = true
		}
		for name := range base {
			if notThemed[name] {
				continue
			}
			if !defined[name] {
				t.Errorf("theme %q does not redefine %s", theme, name)
			}
		}
	}
}
