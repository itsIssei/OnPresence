package services

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type AniListMedia struct {
	ID    int `json:"id"`
	Title struct {
		Romaji  string `json:"romaji"`
		English string `json:"english"`
		Native  string `json:"native"`
	} `json:"title"`
	Type       string `json:"type"`
	Format     string `json:"format"`
	Episodes   int    `json:"episodes"`
	Chapters   int    `json:"chapters"`
	MeanScore  int    `json:"meanScore"`
	CoverImage struct {
		Large string `json:"large"`
	} `json:"coverImage"`
	Description string   `json:"description"`
	Genres      []string `json:"genres"`
}

type AniListResponse struct {
	Data struct {
		Page struct {
			Media []AniListMedia `json:"media"`
		} `json:"Page"`
	} `json:"data"`
}

// SearchAniList queries the AniList GraphQL API for anime or manga
func SearchAniList(query string, mediaType string) ([]AniListMedia, error) {
	graphQLQuery := `
	query ($search: String, $type: MediaType) {
		Page(page: 1, perPage: 8) {
			media(search: $search, type: $type, sort: POPULARITY_DESC) {
				id
				title {
					romaji
					english
					native
				}
				type
				format
				episodes
				chapters
				meanScore
				coverImage {
					large
				}
				description(asHtml: false)
				genres
			}
		}
	}`

	variables := map[string]interface{}{
		"search": query,
	}
	if mediaType != "" {
		variables["type"] = mediaType // "ANIME" or "MANGA"
	}

	requestBody, err := json.Marshal(map[string]interface{}{
		"query":     graphQLQuery,
		"variables": variables,
	})
	if err != nil {
		return nil, err
	}

	client := apiClient
	resp, err := client.Post("https://graphql.anilist.co", "application/json", bytes.NewBuffer(requestBody))
	if err != nil {
		return nil, fmt.Errorf("failed to call AniList API: %w", err)
	}
	defer resp.Body.Close()

	var result AniListResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode AniList response: %w", err)
	}

	return result.Data.Page.Media, nil
}
