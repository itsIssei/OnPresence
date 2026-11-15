package services

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// useFake points the Steam and AniList calls at an httptest server (plain
// client, since the shared one refuses loopback). Nothing leaves the machine.
func useFake(t *testing.T, h http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(h)
	oldClient, oldSteam, oldAL := apiClient, steamAPIBase, aniListEndpoint
	apiClient, steamAPIBase, aniListEndpoint = srv.Client(), srv.URL, srv.URL
	t.Cleanup(func() {
		apiClient, steamAPIBase, aniListEndpoint = oldClient, oldSteam, oldAL
		srv.Close()
	})
}

func reply(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, body)
	}
}

const testSteamID = "12345678901234567"

func TestFetchSteamLibrary(t *testing.T) {
	var gotQuery string
	useFake(t, func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		reply(`{"response":{"game_count":3,"games":[
			{"appid":10,"name":"Zed","playtime_forever":125},
			{"appid":20,"name":"Alpha","playtime_forever":125},
			{"appid":30,"name":"Never","playtime_forever":0},
			{"appid":0,"name":"Bad id"},
			{"appid":40,"name":"  "}]}}`)(w, r)
	})
	items, err := FetchSteamLibrary(testSteamID, "testkey")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gotQuery, "include_appinfo=1") || !strings.Contains(gotQuery, "steamid="+testSteamID) {
		t.Fatalf("query: %s", gotQuery)
	}
	if len(items) != 3 {
		t.Fatalf("items: %+v", items)
	}
	// Most played first, ties by title; 125 min rounds to 2 h.
	if items[0].Title != "Alpha" || items[1].Title != "Zed" || items[0].HoursPlayed != 2 || items[2].HoursPlayed != 0 {
		t.Fatalf("order/hours: %+v", items)
	}
	if items[0].Status != "owned" || items[0].SteamAppID != 20 || !strings.HasPrefix(items[0].CoverImage, "https://") || !strings.HasSuffix(items[0].CoverImage, "/20/header.jpg") {
		t.Fatalf("fields: %+v", items[0])
	}
}

func TestFetchSteamLibraryPrivateEmptyAndErrors(t *testing.T) {
	useFake(t, reply(`{"response":{}}`))
	if _, err := FetchSteamLibrary(testSteamID, "k"); !errors.Is(err, ErrSteamPrivate) {
		t.Fatalf("private: %v", err)
	}
	useFake(t, reply(`{"response":{"game_count":0,"games":[]}}`))
	items, err := FetchSteamLibrary(testSteamID, "k")
	if err != nil || items == nil || len(items) != 0 {
		t.Fatalf("empty: %v %v", items, err)
	}
	useFake(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusForbidden) })
	if _, err := FetchSteamLibrary(testSteamID, "k"); !errors.Is(err, ErrSteamBadKey) {
		t.Fatalf("bad key: %v", err)
	}
	useFake(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusInternalServerError) })
	if _, err := FetchSteamLibrary(testSteamID, "k"); err == nil || errors.Is(err, ErrSteamPrivate) {
		t.Fatalf("500: %v", err)
	}
	if _, err := FetchSteamLibrary("customname", "k"); !errors.Is(err, ErrSteamBadID) {
		t.Fatalf("vanity id: %v", err)
	}
}

func TestSteamErrorsHideKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close() // connection refused: the transport error would carry the URL
	oldClient, oldSteam := apiClient, steamAPIBase
	apiClient, steamAPIBase = http.DefaultClient, url
	defer func() { apiClient, steamAPIBase = oldClient, oldSteam }()
	_, err := FetchSteamLibrary(testSteamID, "SECRETKEY")
	if err == nil || strings.Contains(err.Error(), "SECRETKEY") {
		t.Fatalf("error leaks the key: %v", err)
	}
}

func TestAniListStatusMapping(t *testing.T) {
	cases := map[string]string{
		"CURRENT": "playing", "REPEATING": "playing", "COMPLETED": "completed",
		"DROPPED": "dropped", "PAUSED": "dropped", "PLANNING": "wishlist",
		"completed": "completed", "WHATEVER": "", "": "",
	}
	for in, want := range cases {
		if got := AniListStatus(in); got != want {
			t.Errorf("AniListStatus(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFetchAniListList(t *testing.T) {
	var gotBody string
	useFake(t, func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		reply(`{"data":{"MediaListCollection":{"lists":[
		 {"entries":[
		  {"status":"CURRENT","progress":5,"score":8.5,"media":{"id":1,"title":{"romaji":"Romaji One","english":"English One","native":"x"},"episodes":12,"coverImage":{"large":"https://img.example/1.jpg"},"genres":["A","B","C","D","E","F"]}},
		  {"status":"PLANNING","progress":0,"score":0,"media":{"id":2,"title":{"romaji":"Two"},"episodes":0,"coverImage":{"large":"https://img.example/2.jpg"},"genres":[]}},
		  {"status":"PAUSED","progress":3,"score":7,"media":{"id":3,"title":{"romaji":"Three"},"coverImage":{"large":""},"genres":[]}}]},
		 {"entries":[
		  {"status":"CURRENT","progress":5,"score":8.5,"media":{"id":1,"title":{"romaji":"Romaji One"},"coverImage":{"large":""},"genres":[]}},
		  {"status":"NOPE","media":{"id":4,"title":{"romaji":"Four"}}}]}]}}}`)(w, r)
	})
	items, err := FetchAniListList("someone", "anime")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gotBody, `"someone"`) || !strings.Contains(gotBody, `"ANIME"`) {
		t.Fatalf("request body: %s", gotBody)
	}
	if len(items) != 3 { // id 1 repeated, id 4 has an unknown status
		t.Fatalf("items: %+v", items)
	}
	one := items[0]
	if one.Title != "English One" || one.Status != "playing" || one.Progress != "5/12 ep" || one.Rating != "8.5/10" || one.Type != "anime" || one.AniListID != 1 {
		t.Fatalf("one: %+v", one)
	}
	if one.Tags != "A, B, C, D, E" {
		t.Fatalf("tags: %q", one.Tags)
	}
	if items[1].Title != "Three" || items[1].Status != "dropped" || items[1].Progress != "3 ep" || items[1].Rating != "7/10" {
		t.Fatalf("three: %+v", items[1])
	}
	if items[2].Title != "Two" || items[2].Status != "wishlist" || items[2].Progress != "" || items[2].Rating != "" {
		t.Fatalf("two: %+v", items[2])
	}
}

func TestFetchAniListMangaAndEmpty(t *testing.T) {
	useFake(t, reply(`{"data":{"MediaListCollection":{"lists":[{"entries":[
		{"status":"COMPLETED","progress":40,"score":9,"media":{"id":9,"title":{"romaji":"M"},"chapters":40,"coverImage":{"large":"https://img.example/9.jpg"}}}]}]}}}`))
	items, err := FetchAniListList("someone", "MANGA")
	if err != nil || len(items) != 1 || items[0].Type != "manga" || items[0].Progress != "40/40 ch" || items[0].Status != "completed" {
		t.Fatalf("manga: %+v %v", items, err)
	}
	useFake(t, reply(`{"data":{"MediaListCollection":{"lists":[]}}}`))
	items, err = FetchAniListList("someone", "ANIME")
	if err != nil || items == nil || len(items) != 0 {
		t.Fatalf("empty: %v %v", items, err)
	}
}

func TestFetchAniListErrors(t *testing.T) {
	useFake(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		io.WriteString(w, `{"errors":[{"message":"User not found","status":404}],"data":{"MediaListCollection":null}}`)
	})
	if _, err := FetchAniListList("nobody", "ANIME"); !errors.Is(err, ErrAniListNotFound) {
		t.Fatalf("404: %v", err)
	}
	useFake(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		io.WriteString(w, `{"errors":[{"message":"Private User","status":403}],"data":{"MediaListCollection":null}}`)
	})
	if _, err := FetchAniListList("hidden", "ANIME"); !errors.Is(err, ErrAniListPrivate) {
		t.Fatalf("403: %v", err)
	}
	useFake(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusBadGateway) })
	if _, err := FetchAniListList("someone", "ANIME"); err == nil || errors.Is(err, ErrAniListNotFound) {
		t.Fatalf("502: %v", err)
	}
	if _, err := FetchAniListList("bad name!", "ANIME"); !errors.Is(err, ErrAniListNotFound) {
		t.Fatalf("bad name: %v", err)
	}
}
