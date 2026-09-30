// Package api is the HTTP layer: routing, middleware and handlers.
package api

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"onpresence/server/config"
	"onpresence/server/services"
	"onpresence/server/store"
)

type Server struct {
	cfg   config.Config
	store *store.Store
	web   fs.FS // built frontend (index.html, admin.html, assets/, img/, data/)

	loginIP     *failLimiter
	loginGlobal *failLimiter
	views       *seenSet

	// setupCode is the one-time code for the first-run setup screen. Nil once
	// an admin account exists.
	setupCode atomic.Pointer[string]

	discordCache *services.Cache[*services.LanyardResponse]
	steamCache   *services.Cache[*services.SteamPresenceData]
	lastfmCache  *services.Cache[*services.LastfmTrack]

	og ogCache
}

func New(cfg config.Config, st *store.Store, web fs.FS) (*Server, error) {
	s := &Server{
		cfg:          cfg,
		store:        st,
		web:          web,
		loginIP:      newFailLimiter(5, 15*time.Minute),
		loginGlobal:  newFailLimiter(300, 15*time.Minute),
		views:        newSeenSet(6 * time.Hour),
		discordCache: services.NewCache[*services.LanyardResponse](20 * time.Second),
		steamCache:   services.NewCache[*services.SteamPresenceData](60 * time.Second),
		lastfmCache:  services.NewCache[*services.LastfmTrack](30 * time.Second),
	}
	has, err := st.HasAdmin(context.Background())
	if err != nil {
		return nil, err
	}
	if !has {
		code := store.RandomPassword()[:12]
		s.setupCode.Store(&code)
		slog.Warn("==================================================")
		slog.Warn("no admin account yet: open /admin and enter this setup code", "setup_code", code)
		slog.Warn("==================================================")
	}
	return s, nil
}

// Sweep clears expired in-memory state; run it periodically.
func (s *Server) Sweep() {
	s.loginIP.Sweep()
	s.loginGlobal.Sweep()
}

// Handler returns the full HTTP handler with middleware applied.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	a := s.admin

	// Public API
	mux.HandleFunc("GET /api/v1/profile", s.getPublicProfile)
	mux.HandleFunc("GET /api/v1/vault", s.getVault)
	mux.HandleFunc("GET /api/v1/presence", s.getPresence)
	mux.HandleFunc("POST /api/v1/view", s.postView)
	mux.HandleFunc("GET /go/{id}", s.linkRedirect)
	mux.HandleFunc("GET /og.png", s.serveOG)

	// First-run setup
	mux.HandleFunc("GET /api/v1/setup", s.setupStatus)
	mux.HandleFunc("POST /api/v1/setup", s.setup)

	// Auth
	mux.HandleFunc("POST /api/v1/auth/login", s.login)
	mux.HandleFunc("POST /api/v1/auth/logout", s.logout)
	mux.HandleFunc("GET /api/v1/auth/me", a(s.me))
	mux.HandleFunc("POST /api/v1/auth/password", a(s.changePassword))
	mux.HandleFunc("GET /api/v1/auth/sessions", a(s.listSessions))
	mux.HandleFunc("DELETE /api/v1/auth/sessions/{id}", a(s.deleteSession))
	mux.HandleFunc("POST /api/v1/auth/totp/setup", a(s.totpBegin))
	mux.HandleFunc("POST /api/v1/auth/totp/enable", a(s.totpEnable))
	mux.HandleFunc("POST /api/v1/auth/totp/disable", a(s.totpDisable))

	// Admin: profile
	mux.HandleFunc("GET /api/v1/admin/profile", a(s.getAdminProfile))
	mux.HandleFunc("PUT /api/v1/admin/profile", a(s.putAdminProfile))
	mux.HandleFunc("GET /api/v1/admin/stats", a(s.getStats))
	mux.HandleFunc("GET /api/v1/admin/about", a(s.about))
	mux.HandleFunc("GET /api/v1/admin/snapshots", a(s.listSnapshots))
	mux.HandleFunc("POST /api/v1/admin/snapshots/{id}/restore", a(s.restoreSnapshot))

	// Admin: collections
	for _, c := range []string{"links", "badges", "games", "media", "playlists", "referrals"} {
		mux.HandleFunc("GET /api/v1/admin/"+c, a(s.listCollection(c)))
		mux.HandleFunc("POST /api/v1/admin/"+c, a(s.saveCollection(c, false)))
		mux.HandleFunc("PUT /api/v1/admin/"+c+"/{id}", a(s.saveCollection(c, true)))
		mux.HandleFunc("DELETE /api/v1/admin/"+c+"/{id}", a(s.deleteCollection(c)))
		mux.HandleFunc("PUT /api/v1/admin/"+c+"/order", a(s.reorderCollection(c)))
	}

	// Admin: uploads / media library
	mux.HandleFunc("GET /api/v1/admin/uploads", a(s.listUploads))
	mux.HandleFunc("POST /api/v1/admin/uploads", a(s.upload))
	mux.HandleFunc("DELETE /api/v1/admin/uploads/{id}", a(s.deleteUpload))

	// Admin: importers (server fetches third-party APIs)
	mux.HandleFunc("GET /api/v1/admin/import/anilist", a(s.importAniList))
	mux.HandleFunc("GET /api/v1/admin/import/games", a(s.importGames))
	mux.HandleFunc("GET /api/v1/admin/import/music", a(s.importMusic))

	// Admin: decoration packs, export/restore, backups
	mux.HandleFunc("POST /api/v1/admin/catalog", a(s.syncCatalog))
	mux.HandleFunc("DELETE /api/v1/admin/catalog", a(s.resetCatalog))
	mux.HandleFunc("GET /api/v1/admin/export", a(s.export))
	mux.HandleFunc("POST /api/v1/admin/restore", a(s.restore))
	mux.HandleFunc("GET /api/v1/admin/backups", a(s.listBackups))
	mux.HandleFunc("POST /api/v1/admin/backups", a(s.createBackup))
	mux.HandleFunc("GET /api/v1/admin/backups/{name}", a(s.downloadBackup))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "Not found")
	})

	// Files
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /data/{name}", s.serveCatalog)
	mux.HandleFunc("GET /uploads/{name}", s.serveUpload)
	mux.HandleFunc("/", s.serveWeb)

	return s.logRequests(securityHeaders(csrf(mux)))
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DB.PingContext(r.Context()); err != nil {
		http.Error(w, "db unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Write([]byte("ok"))
}
