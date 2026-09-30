package services

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// LastfmTrack is the most recent (or currently playing) scrobble.
type LastfmTrack struct {
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Album      string `json:"album"`
	Image      string `json:"image"`
	URL        string `json:"url"`
	NowPlaying bool   `json:"now_playing"`
}

// FetchLastfmNowPlaying returns the user's latest track, or nil when the
// user has no scrobbles. Needs a free API key from last.fm/api.
func FetchLastfmNowPlaying(user, apiKey string) (*LastfmTrack, error) {
	if user == "" || apiKey == "" {
		return nil, nil
	}
	q := url.Values{}
	q.Set("method", "user.getrecenttracks")
	q.Set("user", user)
	q.Set("api_key", apiKey)
	q.Set("format", "json")
	q.Set("limit", "1")
	res, err := apiClient.Get("https://ws.audioscrobbler.com/2.0/?" + q.Encode())
	if err != nil {
		// The URL holds the API key; never pass the transport error on.
		return nil, errors.New("last.fm request failed")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("last.fm: " + res.Status)
	}
	var body struct {
		RecentTracks struct {
			Track []struct {
				Name   string `json:"name"`
				URL    string `json:"url"`
				Artist struct {
					Text string `json:"#text"`
				} `json:"artist"`
				Album struct {
					Text string `json:"#text"`
				} `json:"album"`
				Image []struct {
					Text string `json:"#text"`
					Size string `json:"size"`
				} `json:"image"`
				Attr struct {
					NowPlaying string `json:"nowplaying"`
				} `json:"@attr"`
			} `json:"track"`
		} `json:"recenttracks"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&body); err != nil {
		return nil, errors.New("last.fm: bad response")
	}
	if len(body.RecentTracks.Track) == 0 {
		return nil, nil
	}
	t := body.RecentTracks.Track[0]
	out := &LastfmTrack{
		Title:      t.Name,
		Artist:     t.Artist.Text,
		Album:      t.Album.Text,
		NowPlaying: t.Attr.NowPlaying == "true",
	}
	if strings.HasPrefix(t.URL, "https://www.last.fm/") {
		out.URL = t.URL
	}
	for _, img := range t.Image {
		// Largest size wins; the list is ordered small -> extralarge.
		if strings.HasPrefix(img.Text, "https://") && !strings.Contains(img.Text, "2a96cbd8b46e442fc41c2b86b821562f") {
			out.Image = img.Text
		}
	}
	return out, nil
}
