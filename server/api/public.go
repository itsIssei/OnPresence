package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strconv"

	"golang.org/x/sync/errgroup"

	"onpresence/server/models"
	"onpresence/server/services"
	"onpresence/server/store"
)

func (s *Server) getPublicProfile(w http.ResponseWriter, r *http.Request) {
	p, _, err := s.store.Profile(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	out := models.PublicProfile{Profile: p}
	if out.Links, err = s.store.Links(r.Context(), true); err != nil {
		serverError(w, r, err)
		return
	}
	if out.Badges, err = s.store.Badges(r.Context()); err != nil {
		serverError(w, r, err)
		return
	}
	if p.Settings.ShowViewCount {
		out.Views = s.store.Counter(r.Context(), "views")
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getVault(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	p, _, err := s.store.Profile(ctx)
	if err != nil {
		serverError(w, r, err)
		return
	}
	v := models.Vault{Referrals: []models.Referral{}, Games: []models.Game{}, Anime: []models.Media{}, Manga: []models.Media{}, Playlists: []models.Playlist{}}
	if !p.Settings.VaultEnabled {
		writeJSON(w, http.StatusOK, v)
		return
	}
	show := map[string]bool{}
	for _, id := range p.Settings.Sections {
		show[id] = true
	}

	var media []models.Media
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { v.Games, err = s.store.Games(gctx); return })
	g.Go(func() (err error) { media, err = s.store.Media(gctx); return })
	g.Go(func() (err error) { v.Playlists, err = s.store.Playlists(gctx); return })
	g.Go(func() (err error) { v.Referrals, err = s.store.Referrals(gctx, true); return })
	if err := g.Wait(); err != nil {
		serverError(w, r, err)
		return
	}
	for _, m := range media {
		if m.Type == "anime" {
			v.Anime = append(v.Anime, m)
		} else {
			v.Manga = append(v.Manga, m)
		}
	}
	v.Stats = models.VaultStats{Games: len(v.Games), Anime: len(v.Anime), Manga: len(v.Manga), Playlists: len(v.Playlists)}

	if !show["games"] {
		v.Games = []models.Game{}
	}
	if !show["anime"] {
		v.Anime = []models.Media{}
	}
	if !show["manga"] {
		v.Manga = []models.Media{}
	}
	if !show["music"] {
		v.Playlists = []models.Playlist{}
	}
	if !show["referrals"] {
		v.Referrals = []models.Referral{}
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, v)
}

var (
	snowflake  = regexp.MustCompile(`^[0-9]{17,20}$`)
	steamIDFmt = regexp.MustCompile(`^[a-zA-Z0-9_-]{2,64}$`)
)

// getPresence returns cached Discord (Lanyard) and Steam presence for the
// configured IDs only. Visitors cannot query other accounts through it.
func (s *Server) getPresence(w http.ResponseWriter, r *http.Request) {
	p, sec, err := s.store.Profile(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	out := map[string]any{"discord": nil, "discord_override": "", "steam": nil, "lastfm": nil}
	if !p.Settings.ShowPresence {
		writeJSON(w, http.StatusOK, out)
		return
	}
	if p.DiscordStatus != "" && p.DiscordStatus != "auto" {
		out["discord_override"] = p.DiscordStatus
	}

	var g errgroup.Group
	if snowflake.MatchString(p.DiscordID) {
		g.Go(func() error {
			res, err := s.discordCache.Get(p.DiscordID, func() (*services.LanyardResponse, error) {
				return services.FetchLanyardStatus(p.DiscordID)
			})
			if err == nil && res != nil {
				out["discord"] = res.Data
			}
			return nil
		})
	}
	var steam *services.SteamPresenceData
	if steamIDFmt.MatchString(p.SteamID) {
		g.Go(func() error {
			steam, _ = s.steamCache.Get(p.SteamID, func() (*services.SteamPresenceData, error) {
				return services.FetchSteamPresence(p.SteamID, sec.SteamAPIKey)
			})
			return nil
		})
	}
	var lastfm *services.LastfmTrack
	if p.LastfmUsername != "" && sec.LastfmAPIKey != "" && (p.Settings.MusicMode == "auto" || p.Settings.MusicMode == "lastfm") {
		g.Go(func() error {
			lastfm, _ = s.lastfmCache.Get(p.LastfmUsername, func() (*services.LastfmTrack, error) {
				return services.FetchLastfmNowPlaying(p.LastfmUsername, sec.LastfmAPIKey)
			})
			return nil
		})
	}
	g.Wait()
	if steam != nil {
		out["steam"] = steam
	}
	if lastfm != nil {
		out["lastfm"] = lastfm
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, out)
}

// postView counts one view per visitor (hashed IP) per 6 hours.
func (s *Server) postView(w http.ResponseWriter, r *http.Request) {
	sum := sha256.Sum256([]byte("view:" + s.clientIP(r)))
	var n int64
	if s.views.Add(hex.EncodeToString(sum[:8])) {
		var err error
		if n, err = s.store.Increment(r.Context(), "views"); err != nil {
			serverError(w, r, err)
			return
		}
	} else {
		n = s.store.Counter(r.Context(), "views")
	}
	writeJSON(w, http.StatusOK, map[string]int64{"views": n})
}

// linkRedirect counts a click and redirects to the stored link URL (or
// answers 204 for copy-text links).
func (s *Server) linkRedirect(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	url, copyLink, err := s.store.LinkClick(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) || (err == nil && !copyLink && !models.IsLinkURL(url)) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	if copyLink {
		// The page copies the text itself; this request only counts the click.
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, url, http.StatusFound)
}
