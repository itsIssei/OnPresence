package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// Upstream base URLs. Tests point them at an httptest server.
var (
	steamAPIBase    = "https://api.steampowered.com"
	aniListEndpoint = "https://graphql.anilist.co"
)

// Errors the handlers turn into clear messages. Anything else is an upstream
// failure and is reported generically; its text is never sent to the client.
var (
	ErrSteamBadID      = errors.New("steam id is not a SteamID64")
	ErrSteamBadKey     = errors.New("steam rejected the api key")
	ErrSteamPrivate    = errors.New("steam profile game details must be public")
	ErrAniListNotFound = errors.New("anilist user not found")
	ErrAniListPrivate  = errors.New("anilist list is private")
)

const maxLibraryBody = 16 << 20

// LibraryItem is one entry of a library preview. Steam entries fill
// SteamAppID and HoursPlayed; AniList entries fill AniListID, Type, Progress
// and Rating.
type LibraryItem struct {
	SteamAppID  int    `json:"steam_appid,omitempty"`
	AniListID   int    `json:"anilist_id,omitempty"`
	Title       string `json:"title"`
	CoverImage  string `json:"cover_image"`
	HoursPlayed int    `json:"hours_played"`
	Type        string `json:"type,omitempty"` // anime | manga
	Progress    string `json:"progress_info,omitempty"`
	Rating      string `json:"rating,omitempty"`
	Tags        string `json:"tags,omitempty"`
	Status      string `json:"status"`
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// ---------------------------------------------------------------- Steam

type steamOwnedResp struct {
	Response struct {
		GameCount *int `json:"game_count"`
		Games     []struct {
			AppID           int    `json:"appid"`
			Name            string `json:"name"`
			PlaytimeForever int    `json:"playtime_forever"`
		} `json:"games"`
	} `json:"response"`
}

// FetchSteamLibrary lists the games a Steam account owns, with play time.
// It needs a SteamID64 and a Web API key. The key is sent to Steam and is
// never part of an error.
func FetchSteamLibrary(steamID, apiKey string) ([]LibraryItem, error) {
	steamID = strings.TrimSpace(steamID)
	if !isNumericID(steamID) {
		return nil, ErrSteamBadID
	}
	q := neturl.Values{}
	q.Set("key", apiKey)
	q.Set("steamid", steamID)
	q.Set("include_appinfo", "1")
	q.Set("include_played_free_games", "1")
	q.Set("format", "json")
	resp, err := apiClient.Get(steamAPIBase + "/IPlayerService/GetOwnedGames/v0001/?" + q.Encode())
	if err != nil {
		// Transport errors embed the URL, which contains the API key.
		return nil, errors.New("steam library request failed")
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return nil, ErrSteamBadKey
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("steam library status: %d", resp.StatusCode)
	}
	var parsed steamOwnedResp
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxLibraryBody)).Decode(&parsed); err != nil {
		return nil, errors.New("steam library response unreadable")
	}
	// A private profile answers with an empty "response" object. An empty
	// library still carries game_count (0).
	if parsed.Response.GameCount == nil && len(parsed.Response.Games) == 0 {
		return nil, ErrSteamPrivate
	}
	out := make([]LibraryItem, 0, len(parsed.Response.Games))
	for _, g := range parsed.Response.Games {
		title := clip(g.Name, 120)
		if g.AppID <= 0 || title == "" {
			continue
		}
		out = append(out, LibraryItem{
			SteamAppID:  g.AppID,
			Title:       title,
			CoverImage:  steamImages(g.AppID)[0].URL,
			HoursPlayed: (g.PlaytimeForever + 30) / 60,
			Status:      "owned",
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].HoursPlayed != out[j].HoursPlayed {
			return out[i].HoursPlayed > out[j].HoursPlayed
		}
		return strings.ToLower(out[i].Title) < strings.ToLower(out[j].Title)
	})
	return out, nil
}

// ---------------------------------------------------------------- AniList

// AniListStatus maps an AniList list status to an item status. Unknown
// values give "".
func AniListStatus(s string) string {
	switch strings.ToUpper(s) {
	case "CURRENT", "REPEATING":
		return "playing"
	case "COMPLETED":
		return "completed"
	case "DROPPED", "PAUSED":
		return "dropped"
	case "PLANNING":
		return "wishlist"
	}
	return ""
}

var aniListUserFmt = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)

type aniListListResp struct {
	Data struct {
		MediaListCollection *struct {
			Lists []struct {
				Entries []struct {
					Status   string  `json:"status"`
					Progress int     `json:"progress"`
					Score    float64 `json:"score"`
					Media    struct {
						ID    int `json:"id"`
						Title struct {
							Romaji  string `json:"romaji"`
							English string `json:"english"`
							Native  string `json:"native"`
						} `json:"title"`
						Episodes   int `json:"episodes"`
						Chapters   int `json:"chapters"`
						CoverImage struct {
							Large string `json:"large"`
						} `json:"coverImage"`
						Genres []string `json:"genres"`
					} `json:"media"`
				} `json:"entries"`
			} `json:"lists"`
		} `json:"MediaListCollection"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
		Status  int    `json:"status"`
	} `json:"errors"`
}

const aniListListQuery = `query ($user: String, $type: MediaType) {
	MediaListCollection(userName: $user, type: $type) {
		lists {
			entries {
				status
				progress
				score(format: POINT_10_DECIMAL)
				media {
					id
					title { romaji english native }
					episodes
					chapters
					coverImage { large }
					genres
				}
			}
		}
	}
}`

func progressText(done, total int, unit string) string {
	switch {
	case done <= 0:
		return ""
	case total > 0:
		return fmt.Sprintf("%d/%d %s", done, total, unit)
	}
	return fmt.Sprintf("%d %s", done, unit)
}

// FetchAniListList reads the public list of an AniList user. mediaType is
// "ANIME" or "MANGA". No API key is needed.
func FetchAniListList(user, mediaType string) ([]LibraryItem, error) {
	user = strings.TrimSpace(user)
	mediaType = strings.ToUpper(mediaType)
	if !aniListUserFmt.MatchString(user) || (mediaType != "ANIME" && mediaType != "MANGA") {
		return nil, ErrAniListNotFound
	}
	body, err := json.Marshal(map[string]any{
		"query":     aniListListQuery,
		"variables": map[string]any{"user": user, "type": mediaType},
	})
	if err != nil {
		return nil, err
	}
	resp, err := apiClient.Post(aniListEndpoint, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("anilist request failed")
	}
	defer resp.Body.Close()
	// AniList answers errors (unknown or private user) with 4xx and a JSON
	// body, so the body is read whatever the status is.
	var parsed aniListListResp
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxLibraryBody)).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("anilist response unreadable (status %d)", resp.StatusCode)
	}
	for _, e := range parsed.Errors {
		switch {
		case e.Status == 404:
			return nil, ErrAniListNotFound
		case e.Status == 403 || strings.Contains(strings.ToLower(e.Message), "private"):
			return nil, ErrAniListPrivate
		}
	}
	if len(parsed.Errors) > 0 || resp.StatusCode != http.StatusOK || parsed.Data.MediaListCollection == nil {
		return nil, fmt.Errorf("anilist error (status %d)", resp.StatusCode)
	}

	kind, unit := "anime", "ep"
	if mediaType == "MANGA" {
		kind, unit = "manga", "ch"
	}
	out := []LibraryItem{}
	seen := map[int]bool{} // custom lists repeat entries
	for _, l := range parsed.Data.MediaListCollection.Lists {
		for _, e := range l.Entries {
			m := e.Media
			status := AniListStatus(e.Status)
			title := m.Title.English
			if title == "" {
				title = m.Title.Romaji
			}
			if title == "" {
				title = m.Title.Native
			}
			title = clip(title, 160)
			if m.ID <= 0 || title == "" || status == "" || seen[m.ID] {
				continue
			}
			seen[m.ID] = true
			total := m.Episodes
			if kind == "manga" {
				total = m.Chapters
			}
			it := LibraryItem{
				AniListID:  m.ID,
				Title:      title,
				CoverImage: m.CoverImage.Large,
				Type:       kind,
				Progress:   progressText(e.Progress, total, unit),
				Tags:       clip(strings.Join(firstN(m.Genres, 5), ", "), 300),
				Status:     status,
			}
			if e.Score > 0 {
				it.Rating = strings.TrimSuffix(fmt.Sprintf("%.1f", e.Score), ".0") + "/10"
			}
			out = append(out, it)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Title) < strings.ToLower(out[j].Title) })
	return out, nil
}

func firstN(s []string, n int) []string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
