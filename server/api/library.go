package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"onpresence/server/models"
	"onpresence/server/services"
)

// maxBulkItems is how many entries one bulk import may add.
const maxBulkItems = 500

var libraryUserFmt = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)

// libraryItem is one preview row: the entry plus whether it already exists.
type libraryItem struct {
	services.LibraryItem
	Exists bool `json:"exists"`
}

// libraryFetchers are the upstream calls; tests replace them.
type libraryFetchers struct {
	steam   func(steamID, key string) ([]services.LibraryItem, error)
	aniList func(user, mediaType string) ([]services.LibraryItem, error)
}

// libraryFailed reports an upstream failure. Only fixed messages reach the client.
func (s *Server) libraryFailed(w http.ResponseWriter, what string, err error) {
	switch {
	case errors.Is(err, services.ErrSteamPrivate):
		writeError(w, http.StatusBadRequest, "Steam profile game details must be public. Set \"Game details\" to Public in your Steam privacy settings, then try again")
		return
	case errors.Is(err, services.ErrSteamBadKey):
		writeError(w, http.StatusBadRequest, "Steam did not accept the Web API key. Check it in Integrations")
		return
	case errors.Is(err, services.ErrSteamBadID):
		writeError(w, http.StatusBadRequest, "Library import needs your numeric SteamID64 in the profile (17 digits), not a custom profile name")
		return
	case errors.Is(err, services.ErrAniListNotFound):
		writeError(w, http.StatusNotFound, "AniList user not found")
		return
	case errors.Is(err, services.ErrAniListPrivate):
		writeError(w, http.StatusBadRequest, "This AniList list is private")
		return
	}
	s.importFails.Fail("library")
	slog.Warn("library import failed", "source", what, "err", err)
	writeError(w, http.StatusBadGateway, what+" request failed. Try again later")
}

// libraryPreview marks the entries that already exist and answers.
func (s *Server) libraryPreview(w http.ResponseWriter, r *http.Request, items []services.LibraryItem, games bool) {
	keys, err := s.store.ImportKeys(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	out := make([]libraryItem, len(items)) // the cached slice is shared: copy
	for i, it := range items {
		out[i] = libraryItem{LibraryItem: it}
		if games {
			out[i].Exists = keys.HasGame(it.SteamAppID, it.Title)
		} else {
			out[i].Exists = keys.AniList[it.AniListID]
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

// importSteamLibrary previews the games of the profile's Steam account.
func (s *Server) importSteamLibrary(w http.ResponseWriter, r *http.Request) {
	p, sec, err := s.store.Profile(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	switch {
	case sec.SteamAPIKey == "":
		writeError(w, http.StatusBadRequest, "Add a Steam Web API key in Integrations first")
		return
	case strings.TrimSpace(p.SteamID) == "":
		writeError(w, http.StatusBadRequest, "Add your SteamID64 in the profile first")
		return
	}
	if s.importFails.Blocked("library") {
		writeError(w, http.StatusTooManyRequests, "Too many failed imports. Wait a few minutes")
		return
	}
	id, key := strings.TrimSpace(p.SteamID), sec.SteamAPIKey
	items, err := s.libraryCache.Get("steam:"+id+":"+keyDigest(key), func() ([]services.LibraryItem, error) { return s.library.steam(id, key) })
	if err != nil {
		s.libraryFailed(w, "Steam", err)
		return
	}
	s.libraryPreview(w, r, items, true)
}

// importAniListList previews the public anime or manga list of an AniList user.
func (s *Server) importAniListList(w http.ResponseWriter, r *http.Request) {
	user := strings.TrimSpace(r.URL.Query().Get("user"))
	if !libraryUserFmt.MatchString(user) {
		writeError(w, http.StatusBadRequest, "AniList user name required")
		return
	}
	var t string
	switch r.URL.Query().Get("type") {
	case "anime":
		t = "ANIME"
	case "manga":
		t = "MANGA"
	default:
		writeError(w, http.StatusBadRequest, "Type must be anime or manga")
		return
	}
	if s.importFails.Blocked("library") {
		writeError(w, http.StatusTooManyRequests, "Too many failed imports. Wait a few minutes")
		return
	}
	items, err := s.libraryCache.Get("anilist:"+t+":"+strings.ToLower(user), func() ([]services.LibraryItem, error) { return s.library.aniList(user, t) })
	if err != nil {
		s.libraryFailed(w, "AniList", err)
		return
	}
	s.libraryPreview(w, r, items, false)
}

// bulkAdd adds the chosen preview entries. Everything is validated like a
// single save; an entry that already exists is skipped, not an error.
func (s *Server) bulkAdd(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Kind  string          `json:"kind"` // games | media
		Items json.RawMessage `json:"items"`
	}
	if !decode(w, r, &req, 4<<20) {
		return
	}
	v := validationError{}
	var (
		count int
		add   func() (int, int, error)
	)
	switch req.Kind {
	case "games":
		var items []models.Game
		if json.Unmarshal(req.Items, &items) != nil {
			writeError(w, http.StatusBadRequest, "Invalid items")
			return
		}
		count = len(items)
		for i := range items {
			x := &items[i]
			x.ID, x.IsFeatured, x.SortOrder = 0, false, 0
			iv := validationError{}
			validateGame(iv, x)
			if x.SteamAppID <= 0 {
				iv.add("steam_appid", "Required")
			}
			for f, msg := range iv {
				v.add(fmt.Sprintf("items[%d].%s", i, f), msg)
			}
		}
		add = func() (int, int, error) { return s.store.BulkAddGames(r.Context(), items) }
	case "media":
		var items []models.Media
		if json.Unmarshal(req.Items, &items) != nil {
			writeError(w, http.StatusBadRequest, "Invalid items")
			return
		}
		count = len(items)
		for i := range items {
			x := &items[i]
			x.ID, x.IsFeatured, x.SortOrder = 0, false, 0
			iv := validationError{}
			validateMedia(iv, x)
			if x.AniListID <= 0 {
				iv.add("anilist_id", "Required")
			}
			for f, msg := range iv {
				v.add(fmt.Sprintf("items[%d].%s", i, f), msg)
			}
		}
		add = func() (int, int, error) { return s.store.BulkAddMedia(r.Context(), items) }
	default:
		writeError(w, http.StatusBadRequest, "Kind must be games or media")
		return
	}
	switch {
	case count == 0:
		writeError(w, http.StatusBadRequest, "Nothing selected to import")
		return
	case count > maxBulkItems:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Import at most %d items at a time", maxBulkItems))
		return
	}
	if v.respond(w) {
		return
	}
	added, skipped, err := add()
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"added": added, "skipped": skipped})
}

// keyDigest lets a changed API key skip a cached answer without the key itself
// becoming a map key.
func keyDigest(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:6])
}
