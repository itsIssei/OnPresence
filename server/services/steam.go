package services

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"regexp"
	"strings"
)

type SteamPresenceData struct {
	SteamID     string `json:"steam_id"`
	PersonaName string `json:"personaname"`
	Status      string `json:"status"` // "ingame", "online", "away", "offline"
	StatusLabel string `json:"status_label"`
	InGame      bool   `json:"in_game"`
	GameTitle   string `json:"game_title,omitempty"`
	GameID      string `json:"game_id,omitempty"`
	GameBanner  string `json:"game_banner,omitempty"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	ProfileURL  string `json:"profile_url,omitempty"`
	Source      string `json:"source"`
}

type steamWebApiResponse struct {
	Response struct {
		Players []struct {
			SteamID       string `json:"steamid"`
			PersonaName   string `json:"personaname"`
			ProfileURL    string `json:"profileurl"`
			AvatarFull    string `json:"avatarfull"`
			PersonaState  int    `json:"personastate"`
			GameExtraInfo string `json:"gameextrainfo"`
			GameID        string `json:"gameid"`
		} `json:"players"`
	} `json:"response"`
}

type steamCommunityXML struct {
	XMLName      xml.Name `xml:"profile"`
	SteamID64    string   `xml:"steamID64"`
	SteamID      string   `xml:"steamID"`
	OnlineState  string   `xml:"onlineState"`
	StateMessage string   `xml:"stateMessage"`
	AvatarFull   string   `xml:"avatarFull"`
	CustomURL    string   `xml:"customURL"`
	InGameInfo   *struct {
		GameName string `xml:"gameName"`
		GameLink string `xml:"gameLink"`
		GameIcon string `xml:"gameIcon"`
		GameLogo string `xml:"gameLogo"`
	} `xml:"inGameInfo"`
}

// FetchSteamPresence retrieves real-time Steam status via Web API or Community XML
func FetchSteamPresence(steamID string, apiKey string) (*SteamPresenceData, error) {
	if steamID == "" {
		return nil, fmt.Errorf("empty steam id")
	}

	steamID = strings.TrimSpace(steamID)
	client := apiClient

	// 1. If API Key is provided, use official Steam Web API
	if apiKey != "" && isNumericID(steamID) {
		data, err := fetchViaWebAPI(client, steamID, apiKey)
		if err == nil && data != nil {
			return data, nil
		}
	}

	// 2. Otherwise or on fallback, use Steam Community public XML (zero-config, works without API key)
	return fetchViaCommunityXML(client, steamID)
}

func isNumericID(id string) bool {
	matched, _ := regexp.MatchString(`^\d{17}$`, id)
	return matched
}

func fetchViaWebAPI(client *http.Client, steamID string, apiKey string) (*SteamPresenceData, error) {
	url := fmt.Sprintf("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=%s&steamids=%s", neturl.QueryEscape(apiKey), neturl.QueryEscape(steamID))
	resp, err := client.Get(url)
	if err != nil {
		// Transport errors embed the URL, which contains the API key.
		return nil, fmt.Errorf("steam web api request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("steam api status: %d", resp.StatusCode)
	}

	var parsed steamWebApiResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}

	if len(parsed.Response.Players) == 0 {
		return nil, fmt.Errorf("player not found")
	}

	p := parsed.Response.Players[0]
	res := &SteamPresenceData{
		SteamID:     p.SteamID,
		PersonaName: p.PersonaName,
		AvatarURL:   p.AvatarFull,
		ProfileURL:  p.ProfileURL,
		Source:      "steam_web_api",
	}

	if p.GameExtraInfo != "" {
		res.InGame = true
		res.Status = "ingame"
		res.StatusLabel = "In-Game"
		res.GameTitle = p.GameExtraInfo
		res.GameID = p.GameID
		if p.GameID != "" {
			res.GameBanner = fmt.Sprintf("https://cdn.akamai.steamstatic.com/steam/apps/%s/header.jpg", p.GameID)
		}
	} else {
		res.InGame = false
		switch p.PersonaState {
		case 1:
			res.Status = "online"
			res.StatusLabel = "Online"
		case 2:
			res.Status = "away"
			res.StatusLabel = "Busy"
		case 3, 4:
			res.Status = "away"
			res.StatusLabel = "Away"
		default:
			res.Status = "offline"
			res.StatusLabel = "Offline"
		}
	}

	return res, nil
}

func fetchViaCommunityXML(client *http.Client, steamID string) (*SteamPresenceData, error) {
	var url string
	if isNumericID(steamID) {
		url = fmt.Sprintf("https://steamcommunity.com/profiles/%s/?xml=1", steamID)
	} else {
		url = fmt.Sprintf("https://steamcommunity.com/id/%s/?xml=1", steamID)
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("steam community xml status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var xmlData steamCommunityXML
	if err := xml.Unmarshal(body, &xmlData); err != nil {
		return nil, fmt.Errorf("failed to unmarshal steam xml: %w", err)
	}

	res := &SteamPresenceData{
		SteamID:     xmlData.SteamID64,
		PersonaName: xmlData.SteamID,
		AvatarURL:   xmlData.AvatarFull,
		ProfileURL:  fmt.Sprintf("https://steamcommunity.com/profiles/%s", xmlData.SteamID64),
		Source:      "steam_community_xml",
	}

	onlineState := strings.ToLower(xmlData.OnlineState)
	if onlineState == "in-game" || xmlData.InGameInfo != nil {
		res.InGame = true
		res.Status = "ingame"
		res.StatusLabel = "In-Game"
		if xmlData.InGameInfo != nil && xmlData.InGameInfo.GameName != "" {
			res.GameTitle = xmlData.InGameInfo.GameName
			if xmlData.InGameInfo.GameLogo != "" {
				res.GameBanner = xmlData.InGameInfo.GameLogo
			}
		} else {
			parts := strings.Split(xmlData.StateMessage, "<br/>")
			if len(parts) > 1 {
				res.GameTitle = strings.TrimSpace(parts[1])
			} else {
				res.GameTitle = "Playing Game"
			}
		}
	} else if onlineState == "online" {
		res.Status = "online"
		res.StatusLabel = "Online"
	} else {
		res.Status = "offline"
		res.StatusLabel = "Offline"
	}

	return res, nil
}
