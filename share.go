package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// The read-only link lets the owner show the tree to relatives on the same
// network. It never leaves the machine: the token only unlocks a read-only
// view of the app that is already running here.

const shareCookieName = "ft_share"

var (
	shareMutex   sync.RWMutex
	shareToken   string
	shareEnabled bool
)

// shareState is what the settings panel renders.
type shareState struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token"`
	URL     string `json:"url"`
}

func currentShareState(r *http.Request) shareState {
	shareMutex.RLock()
	defer shareMutex.RUnlock()
	state := shareState{Enabled: shareEnabled, Token: shareToken}
	if shareEnabled {
		state.URL = shareURL(r, shareToken)
	}
	return state
}

func shareURL(r *http.Request, token string) string {
	host := r.Host
	if host == "" {
		host = "localhost:" + Port
	}
	return "http://" + host + "/?share=" + token
}

func newShareToken() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err == nil {
		return hex.EncodeToString(buf)
	}
	return fmt.Sprintf("share-%d", time.Now().UnixNano())
}

// handleShare creates (POST), reports (GET) and stops (DELETE) the read-only
// link.
func handleShare(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jsonResponse(w, currentShareState(r))

	case http.MethodPost:
		token := newShareToken()
		shareMutex.Lock()
		shareToken = token
		shareEnabled = true
		shareMutex.Unlock()
		jsonResponse(w, currentShareState(r))

	case http.MethodDelete:
		shareMutex.Lock()
		shareEnabled = false
		shareToken = ""
		shareMutex.Unlock()
		// Stop sharing in this browser too, so the page goes back to editable.
		clearShareCookie(w)
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// shareRequested reports whether this request carries the active share token.
func shareRequested(r *http.Request) bool {
	shareMutex.RLock()
	token := shareToken
	enabled := shareEnabled
	shareMutex.RUnlock()
	if !enabled || token == "" {
		return false
	}
	if got := r.URL.Query().Get("share"); got == token {
		return true
	}
	if cookie, err := r.Cookie(shareCookieName); err == nil && cookie.Value == token {
		return true
	}
	return false
}

// guardWrite blocks every write while a read-only link is in use, so a
// shared link cannot change the tree even if the UI offers a control.
func guardWrite(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next(w, r)
			return
		}
		if shareRequested(r) {
			http.Error(w, "this tree is shared read-only", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}

// guardOwnerOnly blocks the endpoints that expose or change the owner's
// cloud accounts. A shared viewer must not see them at all.
func guardOwnerOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if shareRequested(r) {
			http.Error(w, "this tree is shared read-only", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}

// jsonResponse writes a JSON body with the right content type.
func jsonResponse(w http.ResponseWriter, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payload)
}

// setShareCookie makes the read-only state stick for the browser session, so
// the page can be reloaded without losing it.
func setShareCookie(w http.ResponseWriter, r *http.Request) bool {
	got := r.URL.Query().Get("share")
	if got == "" {
		return false
	}
	shareMutex.RLock()
	valid := shareEnabled && got == shareToken
	shareMutex.RUnlock()
	if !valid {
		return false
	}
	http.SetCookie(w, &http.Cookie{
		Name:     shareCookieName,
		Value:    got,
		Path:     "/",
		MaxAge:   60 * 60 * 24 * 365,
		SameSite: http.SameSiteLaxMode,
	})
	return true
}

// clearShareCookie removes the read-only state from the browser.
func clearShareCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     shareCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		SameSite: http.SameSiteLaxMode,
	})
}
