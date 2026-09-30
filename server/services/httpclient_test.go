package services

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsPublicIP(t *testing.T) {
	cases := map[string]bool{
		"8.8.8.8":         true,
		"1.1.1.1":         true,
		"127.0.0.1":       false,
		"10.1.2.3":        false,
		"172.17.0.1":      false,
		"192.168.1.1":     false,
		"169.254.169.254": false,
		"100.64.0.1":      false,
		"0.0.0.0":         false,
		"::1":             false,
		"fe80::1":         false,
		"fd00::1":         false,
	}
	for ip, want := range cases {
		if got := isPublicIP(net.ParseIP(ip)); got != want {
			t.Errorf("isPublicIP(%s) = %v, want %v", ip, got, want)
		}
	}
}

func TestParseAllowedURL(t *testing.T) {
	ok := []string{
		"https://open.spotify.com/track/abc",
		"https://www.youtube.com/watch?v=x",
		"https://music.youtube.com/playlist?list=y",
		"https://youtu.be/x",
	}
	bad := []string{
		"http://www.youtube.com/watch?v=x",
		"https://127.0.0.1/",
		"https://evil.com/youtube.com",
		"https://www.youtube.com.evil.com/",
		"https://user@www.youtube.com/",
		"https://www.youtube.com:8443/",
		"file:///etc/passwd",
	}
	for _, u := range ok {
		if _, err := parseAllowedURL(u, musicHosts); err != nil {
			t.Errorf("expected %q allowed, got %v", u, err)
		}
	}
	for _, u := range bad {
		if _, err := parseAllowedURL(u, musicHosts); err == nil {
			t.Errorf("expected %q rejected", u)
		}
	}
}

func TestSafeClientRefusesLoopback(t *testing.T) {
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer srv.Close()

	if _, err := apiClient.Get(srv.URL); err == nil {
		t.Fatal("expected loopback request to fail")
	}
	if hits != 0 {
		t.Fatalf("loopback server was hit %d times", hits)
	}
}

func TestFetchMusicMetadataRejectsInternalURL(t *testing.T) {
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer srv.Close()

	if _, err := FetchMusicMetadata(srv.URL+"/youtube.com", "youtube", ""); err == nil {
		t.Fatal("expected error for non-YouTube host")
	}
	if hits != 0 {
		t.Fatal("internal server was contacted")
	}
}
