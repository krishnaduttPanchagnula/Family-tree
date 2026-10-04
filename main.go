package main

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/aws/aws-sdk-go/service/s3/s3manager"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

//go:embed web/index.html web/style.css web/app.js
var webFS embed.FS
var Port = "8099"

// defaultRepository is where releases are published, so the in-app update
// checker works out of the box (go run, Docker, dev builds). Release builds
// overwrite `repository` via GoReleaser ldflags, and the
// FAMILYTREE_RELEASE_REPOSITORY environment variable overrides both — useful
// for pointing a fork at its own repository.
const defaultRepository = "krishnaduttPanchagnula/Family-tree"

var (
	db               *sql.DB
	oauthCfg         *oauth2.Config
	oauthToken       *oauth2.Token // Stored globally for this single-user demo
	storageMode      = "local"     // Options: "local", "s3", "drive"
	s3BucketOverride string        // Bucket chosen interactively via the S3 integration dialog

	version    = "dev"
	commit     = "none"
	date       = "unknown"
	repository = ""
)

// --- Models ---
type Person struct {
	ID           int     `json:"id"`
	Name         string  `json:"name"`
	ImageURL     string  `json:"image_url"`
	PosX         float64 `json:"pos_x"`
	PosY         float64 `json:"pos_y"`
	DOB          string  `json:"dob"` // date of birth, free-form string (e.g. "1969-06-02")
	DOD          string  `json:"dod"` // date of death, empty if living
	BirthCountry string  `json:"birth_country"`
	Profession   string  `json:"profession"`
	Facts        string  `json:"facts"` // biography / interesting facts
}

// Relation values:
//
//	spouse
//	father, mother, child
//	sibling-full, sibling-half, sibling-step   (sub-types used to render
//	different border styles so siblings can be told apart from their
//	sources/spouses in the UI)
type Relationship struct {
	ID        int    `json:"id"`
	Person1ID int    `json:"person1_id"`
	Person2ID int    `json:"person2_id"`
	Relation  string `json:"relation"`
}

// --- Main Init ---
func main() {
	os.MkdirAll("./uploads", os.ModePerm) // Ensure local uploads folder exists
	initDB()
	initOauth()

	http.HandleFunc("/", serveUI)
	http.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("./uploads"))))

	staticFS, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticFS))))

	http.HandleFunc("/api/settings", handleSettings)
	http.HandleFunc("/api/update-check", handleUpdateCheck)
	http.HandleFunc("/api/persons", handlePersons)
	http.HandleFunc("/api/persons/", handlePersonByID) // /api/persons/{id} and /api/persons/{id}/photo
	http.HandleFunc("/api/relationships", handleRelationships)
	http.HandleFunc("/api/relationships/", handleRelationshipByID) // /api/relationships/{id}

	// Data safety: download a full backup, replace all data from a backup, and
	// re-insert rows that a delete just removed (powers the in-app Undo).
	http.HandleFunc("/api/backup", handleBackup)
	http.HandleFunc("/api/restore", handleRestore)
	http.HandleFunc("/api/undo", handleUndo)

	// AWS S3 integration
	http.HandleFunc("/api/s3/buckets", handleS3Buckets)
	http.HandleFunc("/api/s3/select-bucket", handleS3SelectBucket)

	// Google Auth Routes
	http.HandleFunc("/auth/login", handleGoogleLogin)
	http.HandleFunc("/auth/callback", handleGoogleCallback)
	http.HandleFunc("/api/oauth/status", handleOauthStatus)

	fmt.Printf("Server running on http://localhost:%s\n", Port)
	log.Fatal(http.ListenAndServe(":"+Port, nil))
}

func initDB() {
	var err error
	// _fk=1 enables foreign key enforcement on every pooled connection.
	// (A plain "PRAGMA foreign_keys = ON" only affects the single connection
	// it runs on, so with database/sql's pool most inserts would silently
	// skip FK checks.)
	db, err = sql.Open("sqlite3", "./familytree.db?_fk=1")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS persons (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		image_url TEXT,
		pos_x REAL DEFAULT 0,
		pos_y REAL DEFAULT 0,
		dob TEXT DEFAULT '',
		dod TEXT DEFAULT '',
		birth_country TEXT DEFAULT '',
		profession TEXT DEFAULT '',
		facts TEXT DEFAULT ''
	);
	CREATE TABLE IF NOT EXISTS relationships (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		person1_id INTEGER,
		person2_id INTEGER,
		relation TEXT,
		FOREIGN KEY(person1_id) REFERENCES persons(id) ON DELETE CASCADE,
		FOREIGN KEY(person2_id) REFERENCES persons(id) ON DELETE CASCADE
	);`
	if _, err := db.Exec(createTables); err != nil {
		log.Fatal("Failed to init database:", err)
	}

	// Older builds could write relationships pointing at people that don't
	// exist (FK checks were effectively off, and a quick-add bug sent
	// person2_id = 0). Sweep those orphans so they can't break rendering.
	db.Exec(`DELETE FROM relationships
		WHERE person1_id IS NULL OR person2_id IS NULL
		   OR person1_id NOT IN (SELECT id FROM persons)
		   OR person2_id NOT IN (SELECT id FROM persons)`)

	// Migrate older databases created before these columns existed.
	migrateAddColumn("persons", "pos_x", "REAL DEFAULT 0")
	migrateAddColumn("persons", "pos_y", "REAL DEFAULT 0")
	migrateAddColumn("persons", "dob", "TEXT DEFAULT ''")
	migrateAddColumn("persons", "dod", "TEXT DEFAULT ''")
	migrateAddColumn("persons", "birth_country", "TEXT DEFAULT ''")
	migrateAddColumn("persons", "profession", "TEXT DEFAULT ''")
	migrateAddColumn("persons", "facts", "TEXT DEFAULT ''")
}

// migrateAddColumn adds a column to an existing table if it doesn't already
// exist. SQLite has no "ADD COLUMN IF NOT EXISTS", so we check pragma
// table_info first.
func migrateAddColumn(table, column, definition string) {
	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, ctype string
		var notNull, pk int
		var dflt interface{}
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			continue
		}
		if name == column {
			return // already present
		}
	}
	db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition))
}

func initOauth() {
	oauthCfg = &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		RedirectURL:  "http://localhost:8080/auth/callback",
		// Added Drive scope for image uploads
		Scopes: []string{
			"https://www.googleapis.com/auth/spreadsheets",
			"https://www.googleapis.com/auth/drive.file",
		},
		Endpoint: google.Endpoint,
	}
}

// --- Image Upload Logic ---
func uploadImage(file multipart.File, header *multipart.FileHeader) (string, error) {
	filename := fmt.Sprintf("%d_%s", time.Now().Unix(), header.Filename)

	switch storageMode {
	case "s3":
		bucket := s3BucketOverride
		if bucket == "" {
			bucket = os.Getenv("AWS_BUCKET_NAME")
		}
		if bucket == "" {
			return "", fmt.Errorf("no S3 bucket selected - connect to S3 and choose a bucket first")
		}

		sess, err := session.NewSessionWithOptions(session.Options{SharedConfigState: session.SharedConfigEnable})
		if err != nil {
			return "", fmt.Errorf("AWS session error: %w", err)
		}
		uploader := s3manager.NewUploader(sess)
		result, err := uploader.Upload(&s3manager.UploadInput{
			Bucket: aws.String(bucket),
			Key:    aws.String(filename),
			Body:   file,
			ACL:    aws.String("public-read"),
		})
		if err != nil {
			return "", err
		}
		return result.Location, nil

	case "drive":
		if oauthToken == nil {
			return "", fmt.Errorf("Google Drive not authenticated")
		}
		client := oauthCfg.Client(context.Background(), oauthToken)
		srv, err := drive.NewService(context.Background(), option.WithHTTPClient(client))
		if err != nil {
			return "", err
		}

		f := &drive.File{Name: filename}
		res, err := srv.Files.Create(f).Media(file).Do()
		if err != nil {
			return "", err
		}
		// In Drive, you need to set permissions to 'anyone' to display it publicly in an <img> tag,
		// or fetch it securely via API. Returning the webViewLink for simplicity.
		return fmt.Sprintf("https://drive.google.com/uc?id=%s", res.Id), nil

	default: // "local"
		out, err := os.Create(filepath.Join(".", "uploads", filename))
		if err != nil {
			return "", err
		}
		defer out.Close()
		_, err = io.Copy(out, file)
		return "/uploads/" + filename, err
	}
}

// --- AWS S3 Integration ---

// handleS3Buckets uses the default AWS credential chain (environment
// variables, shared ~/.aws/credentials profile, or an EC2/ECS instance role)
// to list every bucket the caller has access to. If credentials are missing
// or invalid, it fails gracefully with a clear error message instead of
// crashing, so the frontend can surface it in the integration dialog.
func handleS3Buckets(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "method not allowed", 405)
		return
	}

	sess, err := session.NewSessionWithOptions(session.Options{SharedConfigState: session.SharedConfigEnable})
	if err != nil {
		http.Error(w, "Could not initialize AWS session: "+err.Error(), 500)
		return
	}

	svc := s3.New(sess)
	out, err := svc.ListBuckets(&s3.ListBucketsInput{})
	if err != nil {
		http.Error(w, "Could not list S3 buckets - check that your AWS credentials are configured correctly: "+err.Error(), 502)
		return
	}

	names := make([]string, 0, len(out.Buckets))
	for _, b := range out.Buckets {
		if b.Name != nil {
			names = append(names, *b.Name)
		}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"buckets": names})
}

// handleS3SelectBucket persists the bucket chosen in the integration dialog
// and switches storage mode to "s3".
func handleS3SelectBucket(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", 405)
		return
	}
	var body struct {
		Bucket string `json:"bucket"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Bucket == "" {
		http.Error(w, "bucket name required", 400)
		return
	}
	s3BucketOverride = body.Bucket
	storageMode = "s3"
	w.WriteHeader(http.StatusOK)
}

// handleOauthStatus lets the frontend know whether a Google account is
// already connected, so the Drive integration dialog can reflect the real
// state instead of assuming disconnected on every page load.
func handleOauthStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]bool{"connected": oauthToken != nil})
}

// --- API Handlers ---
func handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	repo := normalizeRepository(firstNonEmpty(
		os.Getenv("FAMILYTREE_RELEASE_REPOSITORY"), repository, defaultRepository))
	if repo == "" || !strings.Contains(repo, "/") {
		http.Error(w, "release repository is not configured; set FAMILYTREE_RELEASE_REPOSITORY to owner/repo", http.StatusBadRequest)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), "GET", "https://api.github.com/repos/"+repo+"/releases/latest", nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "familytree-update-checker")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "could not reach GitHub releases: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		http.Error(w, "could not find a latest release for "+repo, http.StatusNotFound)
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		http.Error(w, fmt.Sprintf("GitHub returned %s: %s", resp.Status, strings.TrimSpace(string(body))), http.StatusBadGateway)
		return
	}

	var release struct {
		TagName     string    `json:"tag_name"`
		Name        string    `json:"name"`
		HTMLURL     string    `json:"html_url"`
		PublishedAt time.Time `json:"published_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		http.Error(w, "could not parse GitHub release response: "+err.Error(), http.StatusBadGateway)
		return
	}

	currentVersion := version
	updateAvailable := isNewerVersion(release.TagName, currentVersion)
	if currentVersion == "" || currentVersion == "dev" {
		updateAvailable = release.TagName != ""
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"current_version":  currentVersion,
		"latest_version":   release.TagName,
		"update_available": updateAvailable,
		"release_name":     release.Name,
		"release_url":      release.HTMLURL,
		"published_at":     release.PublishedAt,
		"repository":       repo,
		"commit":           commit,
		"build_date":       date,
	})
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func normalizeRepository(repo string) string {
	repo = strings.TrimSpace(repo)
	repo = strings.TrimPrefix(repo, "https://github.com/")
	repo = strings.TrimPrefix(repo, "http://github.com/")
	repo = strings.TrimPrefix(repo, "git@github.com:")
	repo = strings.TrimSuffix(repo, ".git")
	repo = strings.Trim(repo, "/")
	if repo == "<no value>" || repo == "" {
		return ""
	}
	parts := strings.Split(repo, "/")
	if len(parts) < 2 {
		return repo
	}
	return parts[0] + "/" + parts[1]
}

func isNewerVersion(latest, current string) bool {
	latestParts, latestOK := parseVersionParts(latest)
	currentParts, currentOK := parseVersionParts(current)
	if !latestOK || !currentOK {
		return strings.TrimPrefix(latest, "v") != strings.TrimPrefix(current, "v")
	}
	for i := 0; i < len(latestParts); i++ {
		if latestParts[i] > currentParts[i] {
			return true
		}
		if latestParts[i] < currentParts[i] {
			return false
		}
	}
	return false
}

func parseVersionParts(value string) ([3]int, bool) {
	var parts [3]int
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	if cut := strings.IndexAny(value, "+-"); cut >= 0 {
		value = value[:cut]
	}
	if value == "" {
		return parts, false
	}

	segments := strings.Split(value, ".")
	for i := 0; i < len(parts); i++ {
		if i >= len(segments) {
			break
		}
		n, err := strconv.Atoi(segments[i])
		if err != nil {
			return parts, false
		}
		parts[i] = n
	}
	return parts, true
}

func handleSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		r.ParseForm()
		mode := r.FormValue("mode")
		if mode == "local" || mode == "s3" || mode == "drive" {
			storageMode = mode
			w.WriteHeader(http.StatusOK)
		} else {
			http.Error(w, "Invalid mode", 400)
		}
	} else {
		w.Write([]byte(storageMode))
	}
}

func handlePersons(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		persons, err := fetchAllPersons()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		json.NewEncoder(w).Encode(persons)

	} else if r.Method == "POST" {
		// Parse multipart form for file upload
		err := r.ParseMultipartForm(10 << 20) // 10 MB limit
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}

		name := r.FormValue("name")
		posX, _ := strconv.ParseFloat(r.FormValue("pos_x"), 64)
		posY, _ := strconv.ParseFloat(r.FormValue("pos_y"), 64)
		dob := r.FormValue("dob")
		dod := r.FormValue("dod")
		birthCountry := r.FormValue("birth_country")
		profession := r.FormValue("profession")
		facts := r.FormValue("facts")
		var imgURL string

		file, header, err := r.FormFile("pic")
		if err == nil {
			defer file.Close()
			imgURL, err = uploadImage(file, header)
			if err != nil {
				http.Error(w, "Failed to upload image: "+err.Error(), 500)
				return
			}
		}

		res, err := db.Exec(`INSERT INTO persons (name, image_url, pos_x, pos_y, dob, dod, birth_country, profession, facts)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			name, imgURL, posX, posY, dob, dod, birthCountry, profession, facts)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		id, _ := res.LastInsertId()

		json.NewEncoder(w).Encode(Person{
			ID: int(id), Name: name, ImageURL: imgURL, PosX: posX, PosY: posY,
			DOB: dob, DOD: dod, BirthCountry: birthCountry, Profession: profession, Facts: facts,
		})
	}
}

// handlePersonByID handles:
//
//	DELETE /api/persons/{id}          - remove a person, their photo, and any
//	                                     relationships that reference them
//	POST   /api/persons/{id}/photo    - upload/replace just the photo (used by
//	                                     the "Add Photo" dialog)
//	PATCH  /api/persons/{id}          - partial update of name and/or
//	                                     pos_x/pos_y (used by the free-floating
//	                                     canvas for renames and drag-to-move)
func handlePersonByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/persons/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "person id required", 400)
		return
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil {
		http.Error(w, "invalid person id", 400)
		return
	}

	// /api/persons/{id}/photo
	if len(parts) == 2 && parts[1] == "photo" && r.Method == "POST" {
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		file, header, err := r.FormFile("pic")
		if err != nil {
			http.Error(w, "no photo provided", 400)
			return
		}
		defer file.Close()

		imgURL, err := uploadImage(file, header)
		if err != nil {
			http.Error(w, "Failed to upload image: "+err.Error(), 500)
			return
		}

		if _, err := db.Exec("UPDATE persons SET image_url = ? WHERE id = ?", imgURL, id); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"image_url": imgURL})
		return
	}

	// /api/persons/{id}
	if len(parts) == 1 && r.Method == "PATCH" {
		var body struct {
			Name         *string  `json:"name"`
			PosX         *float64 `json:"pos_x"`
			PosY         *float64 `json:"pos_y"`
			DOB          *string  `json:"dob"`
			DOD          *string  `json:"dod"`
			BirthCountry *string  `json:"birth_country"`
			Profession   *string  `json:"profession"`
			Facts        *string  `json:"facts"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if body.Name != nil {
			if _, err := db.Exec("UPDATE persons SET name = ? WHERE id = ?", *body.Name, id); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		if body.PosX != nil && body.PosY != nil {
			if _, err := db.Exec("UPDATE persons SET pos_x = ?, pos_y = ? WHERE id = ?", *body.PosX, *body.PosY, id); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		if body.DOB != nil {
			if _, err := db.Exec("UPDATE persons SET dob = ? WHERE id = ?", *body.DOB, id); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		if body.DOD != nil {
			if _, err := db.Exec("UPDATE persons SET dod = ? WHERE id = ?", *body.DOD, id); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		if body.BirthCountry != nil {
			if _, err := db.Exec("UPDATE persons SET birth_country = ? WHERE id = ?", *body.BirthCountry, id); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		if body.Profession != nil {
			if _, err := db.Exec("UPDATE persons SET profession = ? WHERE id = ?", *body.Profession, id); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		if body.Facts != nil {
			if _, err := db.Exec("UPDATE persons SET facts = ? WHERE id = ?", *body.Facts, id); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		w.WriteHeader(http.StatusOK)
		return
	}

	// /api/persons/{id}
	if len(parts) == 1 && r.Method == "DELETE" {
		// The photo file on disk is intentionally left in place: deleting a
		// person is undoable, and restoring them must not bring back a broken
		// image link. Orphaned files are harmless and can be garbage collected
		// by a future maintenance pass.
		if _, err := db.Exec("DELETE FROM relationships WHERE person1_id = ? OR person2_id = ?", id, id); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if _, err := db.Exec("DELETE FROM persons WHERE id = ?", id); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	http.Error(w, "not found", 404)
}

func handleRelationships(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		rels, err := fetchAllRelationships()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		json.NewEncoder(w).Encode(rels)

	case "POST":
		var rel Relationship
		if err := json.NewDecoder(r.Body).Decode(&rel); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), 400)
			return
		}
		if err := validateRelationship(&rel); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		res, err := db.Exec("INSERT INTO relationships (person1_id, person2_id, relation) VALUES (?, ?, ?)",
			rel.Person1ID, rel.Person2ID, rel.Relation)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		id, _ := res.LastInsertId()
		rel.ID = int(id)
		json.NewEncoder(w).Encode(rel)
	}
}

// validateRelationship rejects relationship payloads that reference missing
// or identical people before they reach the database.
func validateRelationship(rel *Relationship) error {
	if rel.Person1ID <= 0 || rel.Person2ID <= 0 {
		return fmt.Errorf("person1_id and person2_id are required")
	}
	if rel.Person1ID == rel.Person2ID {
		return fmt.Errorf("a person cannot be linked to themselves")
	}
	if strings.TrimSpace(rel.Relation) == "" {
		return fmt.Errorf("relation is required")
	}
	for _, id := range []int{rel.Person1ID, rel.Person2ID} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM persons WHERE id = ?", id).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return fmt.Errorf("person %d does not exist", id)
		}
	}
	return nil
}

// handleRelationshipByID handles DELETE /api/relationships/{id}
func handleRelationshipByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != "DELETE" {
		http.Error(w, "method not allowed", 405)
		return
	}
	idStr := strings.TrimPrefix(r.URL.Path, "/api/relationships/")
	id, err := strconv.Atoi(strings.Trim(idStr, "/"))
	if err != nil {
		http.Error(w, "invalid relationship id", 400)
		return
	}
	if _, err := db.Exec("DELETE FROM relationships WHERE id = ?", id); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Backup / restore / undo ---
//
// backupPayload is the shape used by all three endpoints, so the frontend can
// serialize the same object for a download, a full restore, and an undo of a
// delete.
type backupPayload struct {
	Version       int            `json:"version"`
	ExportedAt    string         `json:"exported_at"`
	Persons       []Person       `json:"persons"`
	Relationships []Relationship `json:"relationships"`
}

func fetchAllPersons() ([]Person, error) {
	rows, err := db.Query(`SELECT id, name, COALESCE(image_url, ''), COALESCE(pos_x, 0), COALESCE(pos_y, 0),
		COALESCE(dob, ''), COALESCE(dod, ''), COALESCE(birth_country, ''), COALESCE(profession, ''), COALESCE(facts, '')
		FROM persons ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	persons := []Person{}
	for rows.Next() {
		var p Person
		if err := rows.Scan(&p.ID, &p.Name, &p.ImageURL, &p.PosX, &p.PosY, &p.DOB, &p.DOD, &p.BirthCountry, &p.Profession, &p.Facts); err != nil {
			return nil, err
		}
		persons = append(persons, p)
	}
	return persons, rows.Err()
}

func fetchAllRelationships() ([]Relationship, error) {
	rows, err := db.Query("SELECT id, person1_id, person2_id, relation FROM relationships ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rels := []Relationship{}
	for rows.Next() {
		var rel Relationship
		if err := rows.Scan(&rel.ID, &rel.Person1ID, &rel.Person2ID, &rel.Relation); err != nil {
			return nil, err
		}
		rels = append(rels, rel)
	}
	return rels, rows.Err()
}

func decodePayload(r *http.Request) (backupPayload, error) {
	var payload backupPayload
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(&payload); err != nil {
		return payload, fmt.Errorf("invalid JSON payload: %w", err)
	}
	return payload, nil
}

// writePayload persists persons and relationships. With wipe=true the existing
// tables are emptied first (full restore); with wipe=false the rows are merged
// in on top of the current data (undo of a delete). Relationship rows that
// point at a person who is neither in the payload nor already stored are
// dropped so a bad backup can never leave dangling references.
func writePayload(payload backupPayload, wipe bool) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if wipe {
		if _, err := tx.Exec("DELETE FROM relationships"); err != nil {
			return err
		}
		if _, err := tx.Exec("DELETE FROM persons"); err != nil {
			return err
		}
	}

	known := map[int]bool{}
	if rows, err := tx.Query("SELECT id FROM persons"); err == nil {
		for rows.Next() {
			var id int
			rows.Scan(&id)
			known[id] = true
		}
		rows.Close()
	}

	for _, p := range payload.Persons {
		if p.ID > 0 {
			known[p.ID] = true
			if _, err := tx.Exec(`INSERT INTO persons (id, name, image_url, pos_x, pos_y, dob, dod, birth_country, profession, facts)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					name = excluded.name, image_url = excluded.image_url, pos_x = excluded.pos_x, pos_y = excluded.pos_y,
					dob = excluded.dob, dod = excluded.dod, birth_country = excluded.birth_country,
					profession = excluded.profession, facts = excluded.facts`,
				p.ID, p.Name, p.ImageURL, p.PosX, p.PosY, p.DOB, p.DOD, p.BirthCountry, p.Profession, p.Facts); err != nil {
				return fmt.Errorf("could not save %q: %w", p.Name, err)
			}
			continue
		}
		if _, err := tx.Exec(`INSERT INTO persons (name, image_url, pos_x, pos_y, dob, dod, birth_country, profession, facts)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			p.Name, p.ImageURL, p.PosX, p.PosY, p.DOB, p.DOD, p.BirthCountry, p.Profession, p.Facts); err != nil {
			return fmt.Errorf("could not save %q: %w", p.Name, err)
		}
	}

	for _, rel := range payload.Relationships {
		if !known[rel.Person1ID] || !known[rel.Person2ID] {
			continue
		}
		if rel.ID > 0 {
			if _, err := tx.Exec(`INSERT INTO relationships (id, person1_id, person2_id, relation)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET person1_id = excluded.person1_id, person2_id = excluded.person2_id, relation = excluded.relation`,
				rel.ID, rel.Person1ID, rel.Person2ID, rel.Relation); err != nil {
				return fmt.Errorf("could not save a relationship: %w", err)
			}
			continue
		}
		if _, err := tx.Exec("INSERT INTO relationships (person1_id, person2_id, relation) VALUES (?, ?, ?)",
			rel.Person1ID, rel.Person2ID, rel.Relation); err != nil {
			return fmt.Errorf("could not save a relationship: %w", err)
		}
	}

	// Keep AUTOINCREMENT ahead of the highest explicit id we just wrote, so a
	// later insert never collides with a restored row.
	tx.Exec("DELETE FROM sqlite_sequence WHERE name IN ('persons', 'relationships')")
	tx.Exec(`INSERT INTO sqlite_sequence (name, seq) SELECT 'persons', COALESCE(MAX(id), 0) FROM persons`)
	tx.Exec(`INSERT INTO sqlite_sequence (name, seq) SELECT 'relationships', COALESCE(MAX(id), 0) FROM relationships`)

	return tx.Commit()
}

// handleBackup downloads the whole tree as a single JSON document.
func handleBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	persons, err := fetchAllPersons()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	rels, err := fetchAllRelationships()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="family-tree-backup-%s.json"`, time.Now().Format("2006-01-02")))
	json.NewEncoder(w).Encode(backupPayload{
		Version:       1,
		ExportedAt:    time.Now().UTC().Format(time.RFC3339),
		Persons:       persons,
		Relationships: rels,
	})
}

// handleRestore replaces every person and relationship with the uploaded
// backup. The client asks for confirmation first and can undo the restore for
// the length of the session via /api/undo.
func handleRestore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	payload, err := decodePayload(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if payload.Persons == nil {
		http.Error(w, "backup has no persons list", http.StatusBadRequest)
		return
	}
	if err := writePayload(payload, true); err != nil {
		http.Error(w, "restore failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]int{"persons": len(payload.Persons), "relationships": len(payload.Relationships)})
}

// handleUndo re-inserts rows that a delete removed (person + their
// relationships, or a single relationship). It merges instead of wiping, so it
// is never destructive on its own.
func handleUndo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	payload, err := decodePayload(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := writePayload(payload, false); err != nil {
		http.Error(w, "undo failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]int{"persons": len(payload.Persons), "relationships": len(payload.Relationships)})
}

// --- Google Auth ---
func handleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	url := oauthCfg.AuthCodeURL("state-token", oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

func handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	token, err := oauthCfg.Exchange(context.Background(), code)
	if err != nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!DOCTYPE html><html><body>
			<p>Google authentication failed: %s</p>
			<script>
				if (window.opener) {
					window.opener.postMessage({ type: 'gdrive-auth-error', error: %q }, '*');
					window.close();
				}
			</script>
		</body></html>`, template.HTMLEscapeString(err.Error()), err.Error())
		return
	}

	// Save token globally so our Drive upload function can use it
	oauthToken = token

	// This callback may be opened either as a full-page redirect or inside a
	// popup window launched by the Drive integration dialog. When it's a
	// popup, notify the opener and close ourselves instead of navigating the
	// popup to the app (which would just leave an orphaned tab open).
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, `<!DOCTYPE html><html><body>
		<p>Connected! You can close this window.</p>
		<script>
			if (window.opener) {
				window.opener.postMessage({ type: 'gdrive-auth-success' }, '*');
				window.close();
			} else {
				window.location = '/?auth=success';
			}
		</script>
	</body></html>`)
}

// --- Embedded UI ---
func serveUI(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	data, err := webFS.ReadFile("web/index.html")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}
