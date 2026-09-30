package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"onpresence/server/models"
	"onpresence/server/services"
)

// ---------------------------------------------------------------- importers

func (s *Server) importAniList(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 100 {
		writeError(w, http.StatusBadRequest, "Search term required")
		return
	}
	t := strings.ToUpper(r.URL.Query().Get("type"))
	if t != "MANGA" {
		t = "ANIME"
	}
	res, err := services.SearchAniList(q, t)
	if err != nil {
		slog.Warn("anilist search failed", "err", err)
		writeError(w, http.StatusBadGateway, "AniList search failed")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) importGames(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 100 {
		writeError(w, http.StatusBadRequest, "Search term required")
		return
	}
	res, err := services.SearchGames(q)
	if err != nil {
		slog.Warn("game search failed", "err", err)
		writeError(w, http.StatusBadGateway, "Game search failed")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) importMusic(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	raw := strings.TrimSpace(q.Get("url"))
	if raw == "" || len(raw) > 500 {
		writeError(w, http.StatusBadRequest, "Music URL required")
		return
	}
	meta, err := services.FetchMusicMetadata(raw, q.Get("platform"), q.Get("type"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, meta)
}

// ---------------------------------------------------------------- decoration packs

// Catalog files listing avatar decorations and profile effects for the
// pickers. The bundled ones (web/public/data) hold the OnPresence originals;
// imported packs are merged in the dashboard and saved to DATA_DIR/catalog.
var catalogFiles = map[string]bool{
	"decorations.json": true,
	"effects.json":     true,
}

func (s *Server) serveCatalog(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !catalogFiles[name] {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	synced := filepath.Join(s.cfg.CatalogDir(), name)
	if fi, err := os.Stat(synced); err == nil && !fi.IsDir() {
		http.ServeFile(w, r, synced)
		return
	}
	s.serveWebFile(w, r, "data/"+name, "public, max-age=300")
}

var catalogID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// catalogURLFields are the image fields of pack entries; each must be a safe
// URL (https or a local path) or the entry is dropped.
var catalogURLFields = []string{"url", "thumbnailPreviewSrc", "reducedMotionSrc", "staticFrameSrc"}

// cleanPackEntries keeps well-formed entries with a safe id and safe image URLs.
func cleanPackEntries(items []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		id, _ := it["id"].(string)
		if !catalogID.MatchString(id) || !safeEntryURLs(it) {
			continue
		}
		out = append(out, it)
	}
	return out
}

func safeEntryURLs(it map[string]any) bool {
	for _, f := range catalogURLFields {
		if v, ok := it[f]; ok {
			if str, ok := v.(string); !ok || !models.IsSafeURL(str) {
				return false
			}
		}
	}
	layers, _ := it["effects"].([]any)
	for _, l := range layers {
		layer, ok := l.(map[string]any)
		if !ok {
			return false
		}
		if src, _ := layer["src"].(string); !models.IsSafeURL(src) {
			return false
		}
		rs, _ := layer["randomizedSources"].([]any)
		for _, x := range rs {
			m, _ := x.(map[string]any)
			if src, _ := m["src"].(string); !models.IsSafeURL(src) {
				return false
			}
		}
	}
	return true
}

func (s *Server) syncCatalog(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Decorations    []map[string]any `json:"decorations"`
		ProfileEffects []map[string]any `json:"profileEffects"`
	}
	if !decode(w, r, &req, 20<<20) {
		return
	}
	dec, eff := cleanPackEntries(req.Decorations), cleanPackEntries(req.ProfileEffects)
	if err := os.MkdirAll(s.cfg.CatalogDir(), 0o750); err != nil {
		serverError(w, r, err)
		return
	}
	write := func(name string, v []map[string]any) error {
		if len(v) == 0 {
			return nil
		}
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		tmp := filepath.Join(s.cfg.CatalogDir(), name+".tmp")
		if err := os.WriteFile(tmp, b, 0o640); err != nil {
			return err
		}
		return os.Rename(tmp, filepath.Join(s.cfg.CatalogDir(), name))
	}
	if err := write("decorations.json", dec); err != nil {
		serverError(w, r, err)
		return
	}
	if err := write("effects.json", eff); err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"decorations": len(dec), "profileEffects": len(eff)})
}

// resetCatalog removes imported packs; the bundled originals remain.
func (s *Server) resetCatalog(w http.ResponseWriter, r *http.Request) {
	for name := range catalogFiles {
		if err := os.Remove(filepath.Join(s.cfg.CatalogDir(), name)); err != nil && !os.IsNotExist(err) {
			serverError(w, r, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------- export / backups

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	e, err := s.store.ExportContent(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="onpresence-export.json"`)
	writeJSON(w, http.StatusOK, e)
}

// restore replaces all content with an export file. Every item goes through
// the same validation as the editor, and a database backup is written first.
func (s *Server) restore(w http.ResponseWriter, r *http.Request) {
	var e models.Export
	e.Profile.Settings = models.DefaultSettings()
	if !decode(w, r, &e, 8<<20) {
		return
	}
	if e.App != "onpresence" || e.Version < 1 || e.Version > models.ExportVersion {
		writeError(w, http.StatusBadRequest, "This is not an OnPresence export file (or it is from a newer version)")
		return
	}
	const maxItems = 2000
	if len(e.Links)+len(e.Badges)+len(e.Games)+len(e.Media)+len(e.Playlists)+len(e.Referrals) > maxItems {
		writeError(w, http.StatusBadRequest, "Too many items in the file")
		return
	}
	v := validationError{}
	validateProfile(v, &e.Profile)
	check := func(section string, i int, one func(validationError)) {
		iv := validationError{}
		one(iv)
		for f, msg := range iv {
			v.add(fmt.Sprintf("%s[%d].%s", section, i, f), msg)
		}
	}
	for i := range e.Links {
		check("links", i, func(iv validationError) { validateLink(iv, &e.Links[i]) })
	}
	for i := range e.Badges {
		check("badges", i, func(iv validationError) { validateBadge(iv, &e.Badges[i]) })
	}
	for i := range e.Games {
		check("games", i, func(iv validationError) { validateGame(iv, &e.Games[i]) })
	}
	for i := range e.Media {
		check("media", i, func(iv validationError) { validateMedia(iv, &e.Media[i]) })
	}
	for i := range e.Playlists {
		check("playlists", i, func(iv validationError) { validatePlaylist(iv, &e.Playlists[i]) })
	}
	for i := range e.Referrals {
		check("referrals", i, func(iv validationError) { validateReferral(iv, &e.Referrals[i]) })
	}
	if v.respond(w) {
		return
	}
	dedupeIDs(e.Links, func(x *models.SocialLink) *int64 { return &x.ID })
	dedupeIDs(e.Badges, func(x *models.Badge) *int64 { return &x.ID })
	dedupeIDs(e.Games, func(x *models.Game) *int64 { return &x.ID })
	dedupeIDs(e.Media, func(x *models.Media) *int64 { return &x.ID })
	dedupeIDs(e.Playlists, func(x *models.Playlist) *int64 { return &x.ID })
	dedupeIDs(e.Referrals, func(x *models.Referral) *int64 { return &x.ID })

	keep := max(s.cfg.BackupKeep, 7)
	if _, err := s.store.Backup(r.Context(), s.cfg.BackupDir(), keep); err != nil {
		serverError(w, r, err)
		return
	}
	if err := s.store.ImportContent(r.Context(), &e); err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// dedupeIDs clears repeated or negative ids so the import picks new ones.
func dedupeIDs[T any](items []T, id func(*T) *int64) {
	seen := map[int64]bool{}
	for i := range items {
		p := id(&items[i])
		if *p <= 0 || seen[*p] {
			*p = 0
			continue
		}
		seen[*p] = true
	}
}

var backupName = regexp.MustCompile(`^onpresence-\d{8}-\d{6}\.db$`)

func (s *Server) listBackups(w http.ResponseWriter, r *http.Request) {
	entries, _ := os.ReadDir(s.cfg.BackupDir())
	type item struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
		Time string `json:"time"`
	}
	out := []item{}
	for _, e := range entries {
		if !backupName.MatchString(e.Name()) {
			continue
		}
		if fi, err := e.Info(); err == nil {
			out = append(out, item{e.Name(), fi.Size(), fi.ModTime().UTC().Format("2006-01-02T15:04:05Z")})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name > out[j].Name })
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) createBackup(w http.ResponseWriter, r *http.Request) {
	keep := s.cfg.BackupKeep
	if keep == 0 {
		keep = 7
	}
	path, err := s.store.Backup(r.Context(), s.cfg.BackupDir(), keep)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"name": filepath.Base(path)})
}

func (s *Server) downloadBackup(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !backupName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Content-Type", "application/vnd.sqlite3")
	http.ServeFile(w, r, filepath.Join(s.cfg.BackupDir(), name))
}
