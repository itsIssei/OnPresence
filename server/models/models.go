// Package models holds the JSON/DB shapes shared by store and api.
package models

// Profile is the singleton owner profile (row id = 1).
type Profile struct {
	Name          string `json:"name"`
	Handle        string `json:"handle"`
	Title         string `json:"title"`
	Bio           string `json:"bio"`
	AvatarURL     string `json:"avatar_url"`
	BackgroundURL string `json:"background_url"` // page background image or video
	CardBgURL     string `json:"card_bg_url"`    // image behind the card content
	AudioURL      string `json:"audio_url"`
	AudioTitle    string `json:"audio_title"`

	DiscordID       string `json:"discord_id"`
	DiscordStatus   string `json:"discord_status"` // auto | online | idle | dnd | offline
	SteamID         string `json:"steam_id"`
	SteamLevel      string `json:"steam_level"`
	AniListUsername string `json:"anilist_username"`
	LastfmUsername  string `json:"lastfm_username"`

	Settings  Settings `json:"settings"`
	UpdatedAt string   `json:"updated_at"`
}

// Settings holds every card/page customization option. It is stored as one
// JSON column, so new options do not need a schema migration. Always call
// Normalize after decoding.
type Settings struct {
	// Appearance
	Theme            string  `json:"theme"`             // preset id, see Themes
	AccentColor      string  `json:"accent_color"`      // #rrggbb
	AvatarDecoration string  `json:"avatar_decoration"` // catalog id, /img/... path, https URL, or "none"
	ProfileEffect    string  `json:"profile_effect"`    // catalog id or "none"
	CardEffect       string  `json:"card_effect"`       // none | glitch | scanlines | gradient-blur
	BackgroundFX     string  `json:"background_fx"`     // none | embers | lightning | magic-circle | all
	CardOpacity      float64 `json:"card_opacity"`      // 0.2 - 1
	CardBlur         int     `json:"card_blur"`         // px, 0 - 40
	AvatarZoom       int     `json:"avatar_zoom"`       // percent, 50 - 200
	AvatarShape      string  `json:"avatar_shape"`      // circle | rounded | square
	NameStyle        string  `json:"name_style"`        // plain | glow | gradient
	CardTilt         bool    `json:"card_tilt"`
	NameFont         string  `json:"name_font"`        // see Fonts
	GateFont         string  `json:"gate_font"`        // see Fonts
	NameLogo         string  `json:"name_logo"`        // image shown instead of the name text; "" = text
	NameLogoMode     string  `json:"name_logo_mode"`   // tint (recolored, all effects) | original (keep colors)
	NameLogoHeight   int     `json:"name_logo_height"` // px, 32 - 140
	EffectOnHover    bool    `json:"effect_on_hover"`  // replay the profile effect on hover

	// Behavior
	EntryGate     bool   `json:"entry_gate"`
	GateText      string `json:"gate_text"`
	MusicMode     string `json:"music_mode"`     // auto | spotify | ytmusic | lastfm | custom | off
	DefaultVolume int    `json:"default_volume"` // percent, for first-time visitors
	ShowPresence  bool   `json:"show_presence"`
	ShowViewCount bool   `json:"show_view_count"`
	ShowCredit    bool   `json:"show_credit"` // small "made with OnPresence" link under the card

	// Display case ("vault")
	VaultEnabled    bool     `json:"vault_enabled"`
	VaultTitle      string   `json:"vault_title"`
	VaultSubtitle   string   `json:"vault_subtitle"`
	VaultBadge      string   `json:"vault_badge"`
	VaultIcon       string   `json:"vault_icon"`
	VaultSteamBadge string   `json:"vault_steam_badge"`
	CollectionScore string   `json:"collection_score"`
	Sections        []string `json:"sections"` // visible sections, in display order
}

var (
	Themes        = []string{"crimson", "violet", "emerald", "ice", "gold", "mono"}
	CardEffects   = []string{"none", "glitch", "scanlines", "gradient-blur"}
	BackgroundFXs = []string{"none", "embers", "lightning", "magic-circle", "all"}
	AvatarShapes  = []string{"circle", "rounded", "square"}
	NameStyles    = []string{"plain", "glow", "gradient"}
	NameLogoModes = []string{"tint", "original"}
	Fonts         = []string{"sora", "inter", "mono", "cinzel", "orbitron", "gothic", "pirata", "creepster"}
	MusicModes    = []string{"auto", "spotify", "ytmusic", "lastfm", "custom", "off"}
	SectionIDs    = []string{"referrals", "games", "anime", "manga", "music"}
	DiscordStates = []string{"auto", "online", "idle", "dnd", "offline"}
)

// DefaultSettings returns the settings used for a fresh profile.
func DefaultSettings() Settings {
	return Settings{
		Theme:            "violet",
		AccentColor:      "#8b5cf6",
		AvatarDecoration: "none",
		ProfileEffect:    "none",
		CardEffect:       "none",
		BackgroundFX:     "embers",
		CardOpacity:      0.75,
		CardBlur:         20,
		AvatarZoom:       100,
		AvatarShape:      "circle",
		NameStyle:        "glow",
		CardTilt:         true,
		NameFont:         "sora",
		GateFont:         "sora",
		NameLogoMode:     "original",
		NameLogoHeight:   72,
		EffectOnHover:    false,
		EntryGate:        true,
		GateText:         "click to enter",
		MusicMode:        "auto",
		DefaultVolume:    10,
		ShowPresence:     true,
		ShowViewCount:    true,
		ShowCredit:       true,
		VaultEnabled:     true,
		VaultTitle:       "Display Case",
		VaultSubtitle:    "Games, anime, manga and music I love.",
		VaultBadge:       "",
		VaultIcon:        "/img/brand/vault.svg",
		Sections:         append([]string(nil), SectionIDs...),
	}
}

// Normalize clamps numbers and replaces unknown enum values with defaults.
func (s *Settings) Normalize() {
	d := DefaultSettings()
	s.Theme = oneOf(s.Theme, Themes, d.Theme)
	s.CardEffect = oneOf(s.CardEffect, CardEffects, d.CardEffect)
	s.BackgroundFX = oneOf(s.BackgroundFX, BackgroundFXs, d.BackgroundFX)
	s.AvatarShape = oneOf(s.AvatarShape, AvatarShapes, d.AvatarShape)
	s.NameStyle = oneOf(s.NameStyle, NameStyles, d.NameStyle)
	s.NameFont = oneOf(s.NameFont, Fonts, d.NameFont)
	s.GateFont = oneOf(s.GateFont, Fonts, d.GateFont)
	s.NameLogoMode = oneOf(s.NameLogoMode, NameLogoModes, d.NameLogoMode)
	s.NameLogoHeight = clampI(s.NameLogoHeight, 32, 140)
	s.DefaultVolume = clampI(s.DefaultVolume, 0, 100)
	s.MusicMode = oneOf(s.MusicMode, MusicModes, d.MusicMode)
	if !IsHexColor(s.AccentColor) {
		s.AccentColor = d.AccentColor
	}
	if s.AvatarDecoration == "" {
		s.AvatarDecoration = "none"
	}
	if s.ProfileEffect == "" {
		s.ProfileEffect = "none"
	}
	s.CardOpacity = clampF(s.CardOpacity, 0.2, 1)
	s.CardBlur = clampI(s.CardBlur, 0, 40)
	s.AvatarZoom = clampI(s.AvatarZoom, 50, 200)
	s.GateText = truncate(s.GateText, 60)

	// Sections: keep known ids once, in the given order.
	seen := map[string]bool{}
	var secs []string
	for _, id := range s.Sections {
		if contains(SectionIDs, id) && !seen[id] {
			seen[id] = true
			secs = append(secs, id)
		}
	}
	if s.Sections == nil {
		secs = append([]string(nil), SectionIDs...)
	}
	if secs == nil {
		secs = []string{}
	}
	s.Sections = secs
}

// Secrets are API keys stored with the profile. They are write-only in the
// API: the admin only sees whether each one is set.
type Secrets struct {
	SteamAPIKey  string
	LastfmAPIKey string
}

// AdminProfile is the profile as the admin sees it.
type AdminProfile struct {
	Profile
	SteamAPIKeySet  bool `json:"steam_api_key_set"`
	LastfmAPIKeySet bool `json:"lastfm_api_key_set"`
}

type SocialLink struct {
	ID        int64  `json:"id"`
	Platform  string `json:"platform"`
	Label     string `json:"label"`
	URL       string `json:"url"`
	Icon      string `json:"icon"`
	SortOrder int    `json:"sort_order"`
	IsActive  bool   `json:"is_active"`
	Clicks    int64  `json:"clicks"`
}

type Badge struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Subtitle  string `json:"subtitle"` // shown as tooltip
	Icon      string `json:"icon"`     // Material Symbols name, /img path or https URL
	Color     string `json:"color"`
	Category  string `json:"category"`
	SortOrder int    `json:"sort_order"`
}

type Game struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Subtitle    string `json:"subtitle"`
	CoverImage  string `json:"cover_image"`
	Rating      string `json:"rating"`
	Badge       string `json:"badge"`
	BadgeType   string `json:"badge_type"` // trash | okay | good | masterpiece
	HoursPlayed int    `json:"hours_played"`
	Category    string `json:"category"`
	ReviewNote  string `json:"review_note"`
	IsFeatured  bool   `json:"is_featured"`
	SortOrder   int    `json:"sort_order"`
	CreatedAt   string `json:"created_at"`
}

var GameBadgeTypes = []string{"trash", "okay", "good", "masterpiece"}

// Media is an anime, manga or manhwa entry.
type Media struct {
	ID            int64  `json:"id"`
	Title         string `json:"title"`
	Type          string `json:"type"` // anime | manga | manhwa
	CoverImage    string `json:"cover_image"`
	Rating        string `json:"rating"`
	RankBadge     string `json:"rank_badge"`
	CategoryBadge string `json:"category_badge"`
	ProgressInfo  string `json:"progress_info"`
	ReviewNote    string `json:"review_note"`
	AniListID     int    `json:"anilist_id"`
	Tags          string `json:"tags"`
	IsFeatured    bool   `json:"is_featured"`
	SortOrder     int    `json:"sort_order"`
	CreatedAt     string `json:"created_at"`
}

var MediaTypes = []string{"anime", "manga", "manhwa"}

type Track struct {
	ID          int64  `json:"id"`
	TrackNumber string `json:"track_number"`
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	Duration    string `json:"duration"`
	AudioURL    string `json:"audio_url"`
}

type Playlist struct {
	ID         int64   `json:"id"`
	Title      string  `json:"title"`
	Subtitle   string  `json:"subtitle"`
	Type       string  `json:"type"` // playlist | solo
	CoverImage string  `json:"cover_image"`
	SpotifyURL string  `json:"spotify_url"`
	YTMusicURL string  `json:"yt_music_url"`
	AudioURL   string  `json:"audio_url"`
	Duration   string  `json:"duration"`
	Artist     string  `json:"artist"`
	IsFeatured bool    `json:"is_featured"`
	SortOrder  int     `json:"sort_order"`
	CreatedAt  string  `json:"created_at"`
	Tracks     []Track `json:"tracks"`
}

var PlaylistTypes = []string{"playlist", "solo"}

// Referral is an entry in the "Projects & referrals" section: either one of
// your own projects/tools (kind=project) or an invite/referral code.
type Referral struct {
	ID           int64  `json:"id"`
	Kind         string `json:"kind"` // project | referral
	Title        string `json:"title"`
	GameName     string `json:"game_name"`
	RefCode      string `json:"ref_code"`
	RefURL       string `json:"ref_url"`
	ImageURL     string `json:"image_url"`
	Description  string `json:"description"`
	RewardText   string `json:"reward_text"`
	Badge        string `json:"badge"`
	DisplayStyle string `json:"display_style"` // banner | card
	SortOrder    int    `json:"sort_order"`
	IsActive     bool   `json:"is_active"`
	CreatedAt    string `json:"created_at"`
}

var (
	ReferralStyles = []string{"banner", "card"}
	ReferralKinds  = []string{"project", "referral"}
)

// Upload is a file in the media library (data/uploads).
type Upload struct {
	ID        int64  `json:"id"`
	URL       string `json:"url"`
	Name      string `json:"name"` // original filename, for display
	Mime      string `json:"mime"`
	Size      int64  `json:"size"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	CreatedAt string `json:"created_at"`
}

type VaultStats struct {
	Games     int `json:"games"`
	Anime     int `json:"anime"`
	Manga     int `json:"manga"`
	Playlists int `json:"playlists"`
}

// Vault is the public display case payload.
type Vault struct {
	Stats     VaultStats `json:"stats"`
	Referrals []Referral `json:"referrals"`
	Games     []Game     `json:"games"`
	Anime     []Media    `json:"anime"`
	Manga     []Media    `json:"manga"`
	Playlists []Playlist `json:"playlists"`
}

// PublicProfile is what /api/v1/profile returns.
type PublicProfile struct {
	Profile
	Links  []SocialLink `json:"links"`
	Badges []Badge      `json:"badges"`
	Views  int64        `json:"views"`
}

// Snapshot is a saved copy of the profile, taken before each change.
type Snapshot struct {
	ID        int64  `json:"id"`
	CreatedAt string `json:"created_at"`
	Name      string `json:"name"` // profile name at the time, for display
}

// Session is an admin login session (token itself is never stored).
type Session struct {
	ID        int64  `json:"id"`
	CreatedAt string `json:"created_at"`
	ExpiresAt string `json:"expires_at"`
	LastSeen  string `json:"last_seen"`
	IP        string `json:"ip"`
	UserAgent string `json:"user_agent"`
	Current   bool   `json:"current"`
}

// ExportVersion is the current content export format.
const ExportVersion = 1

// Export is the full site content as JSON (download and restore). It holds
// no secrets: API keys, the admin account and sessions are not included.
type Export struct {
	App       string       `json:"app"`
	Version   int          `json:"version"`
	Profile   Profile      `json:"profile"`
	Links     []SocialLink `json:"links"`
	Badges    []Badge      `json:"badges"`
	Games     []Game       `json:"games"`
	Media     []Media      `json:"media"`
	Playlists []Playlist   `json:"playlists"`
	Referrals []Referral   `json:"referrals"`
}
