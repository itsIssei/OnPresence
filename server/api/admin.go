package api

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"onpresence/server/models"
)

var (
	assetID       = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	discordFmt    = regexp.MustCompile(`^[a-zA-Z0-9_.]{0,32}$`)
	lastfmUserFmt = regexp.MustCompile(`^[A-Za-z0-9_-]{2,40}$`)
)

// ---------------------------------------------------------------- profile

func (s *Server) getAdminProfile(w http.ResponseWriter, r *http.Request) {
	p, sec, err := s.store.Profile(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, models.AdminProfile{Profile: p, SteamAPIKeySet: sec.SteamAPIKey != "", LastfmAPIKeySet: sec.LastfmAPIKey != ""})
}

var (
	steamKeyFmt  = regexp.MustCompile(`^[A-Fa-f0-9]{32}$`)
	lastfmKeyFmt = regexp.MustCompile(`^[A-Fa-f0-9]{32}$`)
)

func (s *Server) putAdminProfile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		models.Profile
		SteamAPIKey  *string `json:"steam_api_key"`  // omitted = keep, "" = clear
		LastfmAPIKey *string `json:"lastfm_api_key"` // omitted = keep, "" = clear
	}
	req.Settings = models.DefaultSettings()
	if !decode(w, r, &req, 64<<10) {
		return
	}
	p := req.Profile
	v := validationError{}
	validateProfile(v, &p)
	apiKey(v, "steam_api_key", req.SteamAPIKey, steamKeyFmt, "Steam Web API keys are 32 hex characters")
	apiKey(v, "lastfm_api_key", req.LastfmAPIKey, lastfmKeyFmt, "Last.fm API keys are 32 hex characters")
	if v.respond(w) {
		return
	}
	if err := s.store.SaveProfile(r.Context(), p, req.SteamAPIKey, req.LastfmAPIKey); err != nil {
		serverError(w, r, err)
		return
	}
	s.getAdminProfile(w, r)
}

// apiKey trims a write-only key field and checks its format ("" clears it).
func apiKey(v validationError, field string, k *string, re *regexp.Regexp, msg string) {
	if k == nil {
		return
	}
	*k = strings.TrimSpace(*k)
	if *k != "" && !re.MatchString(*k) {
		v.add(field, msg)
	}
}

// validateProfile checks and normalizes every profile field. Used by the
// profile editor and by JSON restore.
func validateProfile(v validationError, p *models.Profile) {
	text(v, "name", &p.Name, 1, 60)
	text(v, "handle", &p.Handle, 0, 40)
	text(v, "title", &p.Title, 0, 80)
	text(v, "bio", &p.Bio, 0, 500)
	text(v, "audio_title", &p.AudioTitle, 0, 120)
	text(v, "steam_level", &p.SteamLevel, 0, 30)
	text(v, "anilist_username", &p.AniListUsername, 0, 40)
	text(v, "lastfm_username", &p.LastfmUsername, 0, 40)
	safeURL(v, "avatar_url", p.AvatarURL)
	safeURL(v, "background_url", p.BackgroundURL)
	safeURL(v, "card_bg_url", p.CardBgURL)
	safeURL(v, "audio_url", p.AudioURL)
	safeURL(v, "settings.vault_icon", p.Settings.VaultIcon)
	safeURL(v, "settings.name_logo", p.Settings.NameLogo)
	p.DiscordID = strings.TrimSpace(p.DiscordID)
	if !discordFmt.MatchString(p.DiscordID) {
		v.add("discord_id", "Use your numeric Discord user ID")
	}
	p.SteamID = strings.TrimSpace(p.SteamID)
	if p.SteamID != "" && !steamIDFmt.MatchString(p.SteamID) {
		v.add("steam_id", "Use a SteamID64 or custom profile name")
	}
	if p.LastfmUsername != "" && !lastfmUserFmt.MatchString(p.LastfmUsername) {
		v.add("lastfm_username", "Letters, digits, dash and underscore only")
	}
	p.DiscordStatus = models.OneOf(p.DiscordStatus, models.DiscordStates, "auto")
	if !validAsset(p.Settings.AvatarDecoration) {
		v.add("settings.avatar_decoration", "Use a catalog id, /img/ path or https URL")
	}
	if !validAsset(p.Settings.ProfileEffect) {
		v.add("settings.profile_effect", "Use a catalog id")
	}
	for _, f := range []*string{&p.Settings.VaultTitle, &p.Settings.VaultSubtitle, &p.Settings.VaultBadge, &p.Settings.VaultSteamBadge, &p.Settings.CollectionScore} {
		*f = models.Truncate(*f, 120)
	}
	p.Settings.Normalize()
}

// ---------------------------------------------------------------- snapshots

func (s *Server) listSnapshots(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Snapshots(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) restoreSnapshot(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.RestoreSnapshot(r.Context(), id); err != nil {
		serverError(w, r, err)
		return
	}
	s.getAdminProfile(w, r)
}

// validAsset accepts "none", a catalog id, a local /img or /uploads path, or https.
func validAsset(v string) bool {
	return v == "" || v == "none" || assetID.MatchString(v) || (models.IsSafeURL(v) && v != "")
}

func (s *Server) about(w http.ResponseWriter, r *http.Request) {
	v := s.cfg.Version
	if v == "" {
		v = "dev"
	}
	writeJSON(w, http.StatusOK, map[string]string{"version": v})
}

func (s *Server) getStats(w http.ResponseWriter, r *http.Request) {
	links, err := s.store.Links(r.Context(), false)
	if err != nil {
		serverError(w, r, err)
		return
	}
	var clicks int64
	for _, l := range links {
		clicks += l.Clicks
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"views":       s.store.Counter(r.Context(), "views"),
		"link_clicks": clicks,
		"links":       links,
	})
}

// ---------------------------------------------------------------- collections

func (s *Server) listCollection(c string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var (
			out any
			err error
		)
		ctx := r.Context()
		switch c {
		case "links":
			out, err = s.store.Links(ctx, false)
		case "badges":
			out, err = s.store.Badges(ctx)
		case "games":
			out, err = s.store.Games(ctx)
		case "media":
			out, err = s.store.Media(ctx)
		case "playlists":
			out, err = s.store.Playlists(ctx)
		case "referrals":
			out, err = s.store.Referrals(ctx, false)
		}
		if err != nil {
			serverError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func (s *Server) saveCollection(c string, update bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var id int64
		if update {
			var ok bool
			if id, ok = pathID(w, r); !ok {
				return
			}
		}
		var (
			item any
			save func(context.Context) error
		)
		v := validationError{}
		switch c {
		case "links":
			x := &models.SocialLink{IsActive: true}
			if !decode(w, r, x, 16<<10) {
				return
			}
			x.ID = id
			validateLink(v, x)
			item, save = x, func(ctx context.Context) error { return s.store.SaveLink(ctx, x) }
		case "badges":
			x := &models.Badge{}
			if !decode(w, r, x, 16<<10) {
				return
			}
			x.ID = id
			validateBadge(v, x)
			item, save = x, func(ctx context.Context) error { return s.store.SaveBadge(ctx, x) }
		case "games":
			x := &models.Game{}
			if !decode(w, r, x, 32<<10) {
				return
			}
			x.ID = id
			validateGame(v, x)
			item, save = x, func(ctx context.Context) error { return s.store.SaveGame(ctx, x) }
		case "media":
			x := &models.Media{}
			if !decode(w, r, x, 32<<10) {
				return
			}
			x.ID = id
			validateMedia(v, x)
			item, save = x, func(ctx context.Context) error { return s.store.SaveMedia(ctx, x) }
		case "playlists":
			x := &models.Playlist{}
			if !decode(w, r, x, 256<<10) {
				return
			}
			x.ID = id
			validatePlaylist(v, x)
			item, save = x, func(ctx context.Context) error { return s.store.SavePlaylist(ctx, x) }
		case "referrals":
			x := &models.Referral{IsActive: true}
			if !decode(w, r, x, 32<<10) {
				return
			}
			x.ID = id
			validateReferral(v, x)
			item, save = x, func(ctx context.Context) error { return s.store.SaveReferral(ctx, x) }
		}
		if v.respond(w) {
			return
		}
		if err := save(r.Context()); err != nil {
			serverError(w, r, err)
			return
		}
		status := http.StatusOK
		if !update {
			status = http.StatusCreated
		}
		writeJSON(w, status, item)
	}
}

func (s *Server) deleteCollection(c string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		if err := s.store.Delete(r.Context(), c, id); err != nil {
			serverError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func (s *Server) reorderCollection(c string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			IDs []int64 `json:"ids"`
		}
		if !decode(w, r, &req, 64<<10) {
			return
		}
		if len(req.IDs) > 2000 {
			writeError(w, http.StatusBadRequest, "Too many ids")
			return
		}
		if err := s.store.Reorder(r.Context(), c, req.IDs); err != nil {
			serverError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ---------------------------------------------------------------- validation helpers

func text(v validationError, field string, s *string, min, max int) {
	*s = strings.TrimSpace(*s)
	n := utf8.RuneCountInString(*s)
	switch {
	case n < min && min == 1:
		v.add(field, "Required")
	case n < min:
		v.add(field, "Too short")
	case n > max:
		v.add(field, "Too long")
	}
}

func safeURL(v validationError, field, u string) {
	if !models.IsSafeURL(u) {
		v.add(field, "Use an https URL or an uploaded file")
	}
}

func validateLink(v validationError, x *models.SocialLink) {
	text(v, "label", &x.Label, 1, 60)
	text(v, "platform", &x.Platform, 0, 30)
	text(v, "icon", &x.Icon, 0, 60)
	x.URL = strings.TrimSpace(x.URL)
	if !models.IsLinkURL(x.URL) {
		v.add("url", "Use an https:// or mailto: link")
	}
}

func validateBadge(v validationError, x *models.Badge) {
	text(v, "title", &x.Title, 1, 40)
	text(v, "subtitle", &x.Subtitle, 0, 120)
	text(v, "category", &x.Category, 0, 30)
	text(v, "icon", &x.Icon, 0, 300)
	if strings.Contains(x.Icon, "/") && !models.IsSafeURL(x.Icon) {
		v.add("icon", "Use an icon name, https URL or uploaded file")
	}
	if x.Color != "" && !models.IsHexColor(x.Color) {
		v.add("color", "Use a #rrggbb color")
	}
}

func validateGame(v validationError, x *models.Game) {
	text(v, "title", &x.Title, 1, 120)
	text(v, "subtitle", &x.Subtitle, 0, 120)
	text(v, "rating", &x.Rating, 0, 40)
	text(v, "badge", &x.Badge, 0, 40)
	text(v, "category", &x.Category, 0, 40)
	text(v, "review_note", &x.ReviewNote, 0, 2000)
	safeURL(v, "cover_image", x.CoverImage)
	x.BadgeType = models.OneOf(strings.ToLower(x.BadgeType), models.GameBadgeTypes, "good")
	if x.HoursPlayed < 0 || x.HoursPlayed > 1_000_000 {
		v.add("hours_played", "Out of range")
	}
}

func validateMedia(v validationError, x *models.Media) {
	text(v, "title", &x.Title, 1, 160)
	text(v, "rating", &x.Rating, 0, 40)
	text(v, "rank_badge", &x.RankBadge, 0, 40)
	text(v, "category_badge", &x.CategoryBadge, 0, 60)
	text(v, "progress_info", &x.ProgressInfo, 0, 120)
	text(v, "review_note", &x.ReviewNote, 0, 2000)
	text(v, "tags", &x.Tags, 0, 300)
	safeURL(v, "cover_image", x.CoverImage)
	x.Type = models.OneOf(strings.ToLower(x.Type), models.MediaTypes, "")
	if x.Type == "" {
		v.add("type", "Choose anime, manga or manhwa")
	}
}

func validatePlaylist(v validationError, x *models.Playlist) {
	text(v, "title", &x.Title, 1, 160)
	text(v, "subtitle", &x.Subtitle, 0, 200)
	text(v, "artist", &x.Artist, 0, 120)
	text(v, "duration", &x.Duration, 0, 20)
	safeURL(v, "cover_image", x.CoverImage)
	safeURL(v, "spotify_url", x.SpotifyURL)
	safeURL(v, "yt_music_url", x.YTMusicURL)
	safeURL(v, "audio_url", x.AudioURL)
	x.Type = models.OneOf(x.Type, models.PlaylistTypes, "playlist")
	if len(x.Tracks) > 300 {
		v.add("tracks", "At most 300 tracks")
	}
	if x.Tracks == nil {
		x.Tracks = []models.Track{}
	}
	for i := range x.Tracks {
		t := &x.Tracks[i]
		t.Title = models.Truncate(t.Title, 160)
		t.Artist = models.Truncate(t.Artist, 120)
		t.Duration = models.Truncate(t.Duration, 20)
		t.TrackNumber = models.Truncate(t.TrackNumber, 10)
		if !models.IsSafeURL(t.AudioURL) {
			v.add("tracks", "Track audio must be an https URL or uploaded file")
		}
	}
}

func validateReferral(v validationError, x *models.Referral) {
	text(v, "title", &x.Title, 1, 120)
	text(v, "game_name", &x.GameName, 0, 80)
	text(v, "ref_code", &x.RefCode, 0, 80)
	text(v, "description", &x.Description, 0, 1000)
	text(v, "reward_text", &x.RewardText, 0, 300)
	text(v, "badge", &x.Badge, 0, 40)
	safeURL(v, "image_url", x.ImageURL)
	x.RefURL = strings.TrimSpace(x.RefURL)
	if x.RefURL != "" && !models.IsLinkURL(x.RefURL) {
		v.add("ref_url", "Use an https:// link or a path on this site like /tools")
	}
	x.DisplayStyle = models.OneOf(x.DisplayStyle, models.ReferralStyles, "banner")
	x.Kind = models.OneOf(x.Kind, models.ReferralKinds, "referral")
}
