package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

type SteamSearchItem struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	TinyImage string `json:"tiny_image"`
	Metascore string `json:"metascore"`
}

type SteamSearchResponse struct {
	Total int               `json:"total"`
	Items []SteamSearchItem `json:"items"`
}

// GameImage is one Steam artwork variant the admin can pick.
type GameImage struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

type GameSearchResult struct {
	ID         int         `json:"id"`
	Title      string      `json:"title"`
	CoverImage string      `json:"cover_image"`
	Images     []GameImage `json:"images"`
	Genres     []string    `json:"genres"`
	Source     string      `json:"source"`
}

// appIDInput matches a bare Steam app id or a Steam store / SteamDB URL.
var appIDInput = regexp.MustCompile(`^(?:\d{1,10}|https?://(?:store\.steampowered\.com|steamdb\.info|steamcommunity\.com)/app/(\d{1,10})\b.*)$`)

func steamImages(id int) []GameImage {
	base := fmt.Sprintf("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/%d/", id)
	return []GameImage{
		{"Header", base + "header.jpg"},
		{"Capsule", base + "capsule_616x353.jpg"},
		{"Hero", base + "library_hero.jpg"},
	}
}

// SearchGames searches the Steam store by name, or looks up one app when
// given an app id, a store.steampowered.com URL or a steamdb.info URL.
func SearchGames(query string) ([]GameSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []GameSearchResult{}, nil
	}
	if m := appIDInput.FindStringSubmatch(query); m != nil {
		idStr := m[1]
		if idStr == "" {
			idStr = query
		}
		id, _ := strconv.Atoi(idStr)
		r, err := steamAppDetails(id)
		if err != nil {
			return nil, err
		}
		return []GameSearchResult{r}, nil
	}

	searchURL := fmt.Sprintf("https://store.steampowered.com/api/storesearch/?term=%s&l=english&cc=US", url.QueryEscape(query))
	resp, err := apiClient.Get(searchURL)
	if err != nil {
		return nil, fmt.Errorf("failed to contact steam store: %w", err)
	}
	defer resp.Body.Close()

	var searchResp SteamSearchResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&searchResp); err != nil {
		return nil, fmt.Errorf("failed to parse steam response: %w", err)
	}

	results := []GameSearchResult{}
	for _, item := range searchResp.Items {
		imgs := steamImages(item.ID)
		results = append(results, GameSearchResult{
			ID:         item.ID,
			Title:      item.Name,
			CoverImage: imgs[0].URL,
			Images:     imgs,
			Source:     "Steam",
		})
	}
	return results, nil
}

type steamAppDetailsResp map[string]struct {
	Success bool `json:"success"`
	Data    struct {
		Name        string `json:"name"`
		HeaderImage string `json:"header_image"`
		Genres      []struct {
			Description string `json:"description"`
		} `json:"genres"`
	} `json:"data"`
}

func steamAppDetails(id int) (GameSearchResult, error) {
	u := fmt.Sprintf("https://store.steampowered.com/api/appdetails?appids=%d&l=english&filters=basic,genres", id)
	resp, err := apiClient.Get(u)
	if err != nil {
		return GameSearchResult{}, fmt.Errorf("failed to contact steam store: %w", err)
	}
	defer resp.Body.Close()
	var d steamAppDetailsResp
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&d); err != nil {
		return GameSearchResult{}, fmt.Errorf("failed to parse steam response: %w", err)
	}
	app, ok := d[strconv.Itoa(id)]
	if !ok || !app.Success {
		return GameSearchResult{}, fmt.Errorf("steam app %d not found", id)
	}
	imgs := steamImages(id)
	if app.Data.HeaderImage != "" {
		imgs[0].URL = app.Data.HeaderImage // exact URL, handles newer hashed asset paths
	}
	r := GameSearchResult{ID: id, Title: app.Data.Name, CoverImage: imgs[0].URL, Images: imgs, Source: "Steam"}
	for _, g := range app.Data.Genres {
		r.Genres = append(r.Genres, g.Description)
	}
	return r, nil
}
