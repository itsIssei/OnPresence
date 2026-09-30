package services

import (
	"encoding/json"
	"fmt"
	"net/http"
)

type LanyardResponse struct {
	Success bool `json:"success"`
	Data    struct {
		DiscordUser struct {
			ID            string `json:"id"`
			Username      string `json:"username"`
			Discriminator string `json:"discriminator"`
			Avatar        string `json:"avatar"`
		} `json:"discord_user"`
		DiscordStatus      string `json:"discord_status"` // "online", "idle", "dnd", "offline"
		ActiveOnDiscordWeb bool   `json:"active_on_discord_web"`
		ListeningToSpotify bool   `json:"listening_to_spotify"`
		Spotify            *struct {
			TrackID    string `json:"track_id"`
			Song       string `json:"song"`
			Artist     string `json:"artist"`
			Album      string `json:"album"`
			AlbumArt   string `json:"album_art_url"`
			Timestamps struct {
				Start int64 `json:"start"`
				End   int64 `json:"end"`
			} `json:"timestamps"`
		} `json:"spotify"`
		Activities []struct {
			Name          string                 `json:"name"`
			Type          int                    `json:"type"`
			State         string                 `json:"state"`
			Details       string                 `json:"details"`
			ApplicationID string                 `json:"application_id"`
			Timestamps    map[string]interface{} `json:"timestamps,omitempty"`
			Assets        map[string]interface{} `json:"assets,omitempty"`
			SyncID        string                 `json:"sync_id,omitempty"`
		} `json:"activities"`
	} `json:"data"`
}

// FetchLanyardStatus retrieves real-time Discord presence from the Lanyard API
func FetchLanyardStatus(discordUserID string) (*LanyardResponse, error) {
	if discordUserID == "" {
		return nil, fmt.Errorf("empty discord user id")
	}

	client := apiClient
	url := fmt.Sprintf("https://api.lanyard.rest/v1/users/%s", discordUserID)
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("lanyard request error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errPayload struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&errPayload); err == nil && errPayload.Error.Message != "" {
			return nil, fmt.Errorf("%s (%s)", errPayload.Error.Message, errPayload.Error.Code)
		}
		return nil, fmt.Errorf("lanyard status code: %d", resp.StatusCode)
	}

	var result LanyardResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode lanyard json: %w", err)
	}

	return &result, nil
}
