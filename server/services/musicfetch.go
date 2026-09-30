package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

type MusicMetadata struct {
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	CoverImage  string `json:"cover_image"`
	Type        string `json:"type"` // "playlist" or "solo"
	Duration    string `json:"duration"`
	SpotifyURL  string `json:"spotify_url"`
	YTMusicURL  string `json:"yt_music_url"`
	Description string `json:"description"`
}

type oEmbedSpotify struct {
	Title        string `json:"title"`
	ThumbnailURL string `json:"thumbnail_url"`
	ProviderName string `json:"provider_name"`
	HTML         string `json:"html"`
}

type oEmbedYouTube struct {
	Title        string `json:"title"`
	AuthorName   string `json:"author_name"`
	AuthorURL    string `json:"author_url"`
	ThumbnailURL string `json:"thumbnail_url"`
	ProviderName string `json:"provider_name"`
}

// FetchMusicMetadata fetches title, author/artist, and cover image from Spotify, YouTube, or direct link
func FetchMusicMetadata(rawURL, platform, contentType string) (*MusicMetadata, error) {
	cleanURL := strings.TrimSpace(rawURL)
	if cleanURL == "" {
		return nil, fmt.Errorf("URL is required")
	}

	client := musicClient
	meta := &MusicMetadata{
		Type: "solo",
	}

	if contentType == "playlist" || contentType == "album" {
		meta.Type = "playlist"
	}

	lower := strings.ToLower(cleanURL)

	// Direct audio link handling (.mp3, .wav, .ogg, catbox, etc.)
	if platform == "direct" || strings.HasSuffix(lower, ".mp3") || strings.HasSuffix(lower, ".wav") || strings.HasSuffix(lower, ".ogg") || strings.Contains(lower, "catbox.moe") {
		parts := strings.Split(cleanURL, "/")
		fileName := parts[len(parts)-1]
		fileName = strings.TrimSuffix(fileName, ".mp3")
		fileName = strings.TrimSuffix(fileName, ".wav")
		fileName = strings.TrimSuffix(fileName, ".ogg")
		meta.Title = strings.ReplaceAll(fileName, "-", " ")
		meta.Title = strings.ReplaceAll(meta.Title, "_", " ")
		meta.Artist = "Direct Audio Source"
		meta.CoverImage = "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80"
		return meta, nil
	}

	// 1. SPOTIFY HANDLING
	if platform == "spotify" || strings.Contains(lower, "spotify.com") {
		if _, err := parseAllowedURL(cleanURL, musicHosts); err != nil {
			return nil, fmt.Errorf("only https Spotify links are supported")
		}
		meta.SpotifyURL = cleanURL
		if contentType == "playlist" || contentType == "album" || strings.Contains(lower, "/playlist/") || strings.Contains(lower, "/album/") {
			meta.Type = "playlist"
		} else {
			meta.Type = "solo"
		}

		// Clean URL to prevent oEmbed failure with query tokens
		cleanSpotify := cleanURL
		if u, err := url.Parse(cleanURL); err == nil {
			u.RawQuery = ""
			cleanSpotify = u.String()
		}

		oembedURL := fmt.Sprintf("https://open.spotify.com/oembed?url=%s", url.QueryEscape(cleanSpotify))
		resp, err := client.Get(oembedURL)
		if err != nil {
			return nil, fmt.Errorf("could not reach Spotify")
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			var s oEmbedSpotify
			if err := json.NewDecoder(resp.Body).Decode(&s); err == nil {
				meta.Title = s.Title
				meta.CoverImage = s.ThumbnailURL

				// Parse format "Track - song and lyrics by Artist"
				if strings.Contains(meta.Title, " - ") {
					parts := strings.Split(meta.Title, " - ")
					meta.Title = strings.TrimSpace(parts[0])
					if len(parts) > 1 {
						art := parts[1]
						art = strings.TrimPrefix(art, "song and lyrics by ")
						art = strings.TrimPrefix(art, "song by ")
						meta.Artist = strings.TrimSpace(art)
					}
				}
				if meta.Artist == "" {
					meta.Artist = "Spotify Curated"
				}
				return meta, nil
			}
		}

		return nil, fmt.Errorf("could not read this Spotify link. Use a track, album or playlist URL")
	}

	// 2. YOUTUBE / YOUTUBE MUSIC HANDLING
	if platform == "ytmusic" || platform == "youtube" || strings.Contains(lower, "youtube.com") || strings.Contains(lower, "youtu.be") {
		if _, err := parseAllowedURL(cleanURL, musicHosts); err != nil {
			return nil, fmt.Errorf("only https YouTube / YouTube Music links are supported")
		}
		meta.YTMusicURL = cleanURL
		isPlaylist := contentType == "playlist" || strings.Contains(lower, "list=") || strings.Contains(lower, "/playlist")
		if isPlaylist {
			meta.Type = "playlist"
		} else {
			meta.Type = "solo"
		}

		// 2a. Single video (watch?v=) via official oEmbed
		if !isPlaylist {
			normalizedURL := strings.Replace(cleanURL, "music.youtube.com", "www.youtube.com", 1)
			oembedURL := fmt.Sprintf("https://www.youtube.com/oembed?url=%s&format=json", url.QueryEscape(normalizedURL))
			resp, err := client.Get(oembedURL)
			if err == nil && resp.StatusCode == http.StatusOK {
				defer resp.Body.Close()
				var y oEmbedYouTube
				if err := json.NewDecoder(resp.Body).Decode(&y); err == nil && y.Title != "" {
					meta.Title = y.Title
					meta.Artist = y.AuthorName
					meta.CoverImage = y.ThumbnailURL
					return meta, nil
				}
			} else if resp != nil {
				resp.Body.Close()
			}
		}

		// 2b. Playlist: Direct HTML scraping from www.youtube.com/playlist?list=...
		urlsToTry := []string{cleanURL}
		if strings.Contains(cleanURL, "music.youtube.com") {
			urlsToTry = append([]string{strings.Replace(cleanURL, "music.youtube.com", "www.youtube.com", 1)}, cleanURL)
		}

		for _, targetURL := range urlsToTry {
			req, err := http.NewRequest("GET", targetURL, nil)
			if err != nil {
				continue
			}
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
			req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
			req.Header.Set("Accept-Language", "en-US,en;q=0.9,tr;q=0.8")
			req.Header.Set("Cookie", "SOCS=CAESEwgDEgk2OTc3OTM3NDcaAmVuIAEaBgiA_LyaBg; CONSENT=YES+cb.20230531-04-p0.en+FX+999")

			pageResp, err := client.Do(req)
			if err != nil || pageResp == nil {
				continue
			}
			if pageResp.StatusCode != http.StatusOK {
				pageResp.Body.Close()
				continue
			}

			bodyBytes, err := io.ReadAll(io.LimitReader(pageResp.Body, 1024*1024*2))
			pageResp.Body.Close()
			if err != nil || len(bodyBytes) == 0 {
				continue
			}
			html := string(bodyBytes)

			// Extract title via OpenGraph or Header Renderer
			reOgTitle := regexp.MustCompile(`(?i)<meta\s+(?:property|name)=["'](?:og:title|twitter:title|title)["']\s+content=["']([^"']+)["']`)
			reOgTitleRev := regexp.MustCompile(`(?i)<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:title|twitter:title|title)["']`)
			reHeaderTitle := regexp.MustCompile(`"playlistHeaderRenderer":\{.*?"title":\{"runs":\[\{"text":"([^"]+)"`)
			reSidebarTitle := regexp.MustCompile(`"playlistSidebarPrimaryInfoRenderer":\{.*?"title":\{"runs":\[\{"text":"([^"]+)"`)
			reJsonTitle := regexp.MustCompile(`"(?:title|headline)":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([^"]+)"`)
			reStdTitle := regexp.MustCompile(`(?i)<title>([^<]+)</title>`)

			var foundTitle string
			if m := reHeaderTitle.FindStringSubmatch(html); len(m) > 1 && strings.TrimSpace(m[1]) != "" {
				foundTitle = strings.TrimSpace(m[1])
			} else if m := reSidebarTitle.FindStringSubmatch(html); len(m) > 1 && strings.TrimSpace(m[1]) != "" {
				foundTitle = strings.TrimSpace(m[1])
			} else if m := reOgTitle.FindStringSubmatch(html); len(m) > 1 && strings.TrimSpace(m[1]) != "" {
				foundTitle = strings.TrimSpace(m[1])
			} else if m := reOgTitleRev.FindStringSubmatch(html); len(m) > 1 && strings.TrimSpace(m[1]) != "" {
				foundTitle = strings.TrimSpace(m[1])
			} else if m := reJsonTitle.FindStringSubmatch(html); len(m) > 1 && strings.TrimSpace(m[1]) != "" {
				foundTitle = strings.TrimSpace(m[1])
			} else if m := reStdTitle.FindStringSubmatch(html); len(m) > 1 {
				t := strings.TrimSpace(m[1])
				t = strings.TrimSuffix(t, " - YouTube")
				t = strings.TrimSuffix(t, " - YouTube Music")
				if t != "YouTube" && t != "YouTube Music" && t != "" && !strings.Contains(t, "deprecated") {
					foundTitle = t
				}
			}

			if foundTitle != "" {
				foundTitle = strings.TrimSuffix(foundTitle, " - YouTube")
				foundTitle = strings.TrimSuffix(foundTitle, " - YouTube Music")
				meta.Title = foundTitle

				// Extract cover image
				reOgImg := regexp.MustCompile(`(?i)<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["']([^"']+)["']`)
				reOgImgRev := regexp.MustCompile(`(?i)<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image)["']`)
				reThumb := regexp.MustCompile(`"(?:thumbnails|thumbnail)":\s*\[.*?\{\s*"url":\s*"([^"]+)"`)
				if m := reOgImg.FindStringSubmatch(html); len(m) > 1 {
					meta.CoverImage = strings.TrimSpace(m[1])
				} else if m := reOgImgRev.FindStringSubmatch(html); len(m) > 1 {
					meta.CoverImage = strings.TrimSpace(m[1])
				} else if m := reThumb.FindStringSubmatch(html); len(m) > 1 {
					meta.CoverImage = strings.TrimSpace(m[1])
				}

				// Extract artist / channel
				reOgDesc := regexp.MustCompile(`(?i)<meta\s+(?:property|name)=["'](?:og:description|description)["']\s+content=["']([^"']+)["']`)
				if m := reOgDesc.FindStringSubmatch(html); len(m) > 1 {
					desc := strings.TrimSpace(m[1])
					if len(desc) < 60 && !strings.Contains(desc, "Enjoy the videos") {
						meta.Artist = desc
					}
				}
				if meta.Artist == "" {
					meta.Artist = "YouTube Music Curated"
				}

				return meta, nil
			}
		}

		// 2c. Mix / Algorithmic fallback
		meta.Title = "YouTube Music Mix / Radio Playlist"
		meta.Artist = "YouTube Music"
		meta.CoverImage = "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80"
		return meta, nil
	}

	return nil, fmt.Errorf("unsupported music link. Use a Spotify, YouTube or YouTube Music URL")
}
