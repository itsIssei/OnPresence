package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"onpresence/server/services"
)

const (
	testSteamID  = "12345678901234567"
	testSteamKey = "0123456789abcdef0123456789abcdef"
)

// withSteam stores a Steam id and key in the profile.
func (e *env) withSteam(id, key string) {
	e.t.Helper()
	_, body := e.do("GET", "/api/v1/admin/profile", nil)
	var p map[string]any
	json.Unmarshal([]byte(body), &p)
	p["steam_id"] = id
	if key != "" {
		p["steam_api_key"] = key
	}
	if res, body := e.do("PUT", "/api/v1/admin/profile", p); res.StatusCode != 200 {
		e.t.Fatalf("save profile: %d %s", res.StatusCode, body)
	}
}

type previewRow struct {
	SteamAppID int    `json:"steam_appid"`
	AniListID  int    `json:"anilist_id"`
	Title      string `json:"title"`
	Status     string `json:"status"`
	Exists     bool   `json:"exists"`
}

func (e *env) preview(path string) []previewRow {
	e.t.Helper()
	res, body := e.do("GET", path, nil)
	if res.StatusCode != 200 {
		e.t.Fatalf("preview %s: %d %s", path, res.StatusCode, body)
	}
	var out struct {
		Items []previewRow `json:"items"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil || out.Items == nil {
		e.t.Fatalf("preview body: %v %s", err, body)
	}
	return out.Items
}

func TestSteamLibraryPreviewAndDedupe(t *testing.T) {
	e := newEnv(t)
	e.login()
	calls := 0
	var gotKey string
	e.app.library.steam = func(id, key string) ([]services.LibraryItem, error) {
		calls++
		gotKey = key
		return []services.LibraryItem{
			{SteamAppID: 10, Title: "Alpha", CoverImage: "https://example.com/a.jpg", HoursPlayed: 5, Status: "owned"},
			{SteamAppID: 20, Title: "Beta", CoverImage: "https://example.com/b.jpg", Status: "owned"},
			{SteamAppID: 30, Title: "Old Game", Status: "owned"},
		}, nil
	}
	// No key: a clear message and no upstream call.
	e.withSteam(testSteamID, "")
	res, body := e.do("GET", "/api/v1/admin/import/steam-library", nil)
	if res.StatusCode != 400 || !strings.Contains(body, "Web API key") || calls != 0 {
		t.Fatalf("no key: %d %s calls=%d", res.StatusCode, body, calls)
	}
	// An old game without an app id is matched by title, ignoring case.
	e.do("POST", "/api/v1/admin/games", map[string]any{"title": "  old GAME "})
	e.withSteam(testSteamID, testSteamKey)
	rows := e.preview("/api/v1/admin/import/steam-library")
	if calls != 1 || gotKey != testSteamKey || len(rows) != 3 || rows[0].Exists || rows[1].Exists || !rows[2].Exists {
		t.Fatalf("preview: calls=%d rows=%+v", calls, rows)
	}

	add := func(items ...map[string]any) (int, string) {
		res, body := e.do("POST", "/api/v1/admin/import/bulk", map[string]any{"kind": "games", "items": items})
		return res.StatusCode, body
	}
	a := map[string]any{"steam_appid": 10, "title": "Alpha", "cover_image": "https://example.com/a.jpg", "hours_played": 5, "status": "owned"}
	b := map[string]any{"steam_appid": 20, "title": "Beta", "status": "playing"}
	old := map[string]any{"steam_appid": 30, "title": "Old Game"}
	code, out := add(a, b, old, a) // the repeat inside the batch is skipped too
	if code != 200 || !strings.Contains(out, `"added":2`) || !strings.Contains(out, `"skipped":2`) {
		t.Fatalf("first add: %d %s", code, out)
	}
	code, out = add(a, b)
	if code != 200 || !strings.Contains(out, `"added":0`) || !strings.Contains(out, `"skipped":2`) {
		t.Fatalf("second add: %d %s", code, out)
	}
	_, games := e.do("GET", "/api/v1/admin/games", nil)
	if strings.Count(games, `"title":"Alpha"`) != 1 || strings.Count(games, `"title":"Beta"`) != 1 || !strings.Contains(games, `"steam_appid":10`) || !strings.Contains(games, `"status":"playing"`) {
		t.Fatalf("games: %s", games)
	}
	// New rows go to the end.
	var list []struct {
		Title     string `json:"title"`
		SortOrder int    `json:"sort_order"`
		CreatedAt string `json:"created_at"`
	}
	json.Unmarshal([]byte(games), &list)
	order := map[string]int{}
	for _, g := range list {
		order[g.Title] = g.SortOrder
		if g.Title == "Alpha" && g.CreatedAt == "" {
			t.Fatal("created_at not set")
		}
	}
	if order["Alpha"] < 1 || order["Beta"] != order["Alpha"]+1 {
		t.Fatalf("sort order: %v", order)
	}
	rows = e.preview("/api/v1/admin/import/steam-library")
	if !rows[0].Exists || !rows[1].Exists || !rows[2].Exists {
		t.Fatalf("preview after import: %+v", rows)
	}
}

func TestLibraryErrorsHideUpstream(t *testing.T) {
	e := newEnv(t)
	e.login()
	e.withSteam(testSteamID, testSteamKey)
	for _, tc := range []struct {
		err    error
		status int
		want   string
	}{
		{services.ErrSteamPrivate, 400, "must be public"},
		{services.ErrSteamBadKey, 400, "did not accept"},
		{errors.New("dial tcp secret-host:443 key=" + testSteamKey), 502, "Steam request failed"},
	} {
		e.app.library.steam = func(string, string) ([]services.LibraryItem, error) { return nil, tc.err }
		e.app.libraryCache = services.NewCache[[]services.LibraryItem](0)
		res, body := e.do("GET", "/api/v1/admin/import/steam-library", nil)
		if res.StatusCode != tc.status || !strings.Contains(body, tc.want) || strings.Contains(body, "secret-host") || strings.Contains(body, testSteamKey) {
			t.Fatalf("%v: %d %s", tc.err, res.StatusCode, body)
		}
	}
	// The key is never part of any admin response.
	_, prof := e.do("GET", "/api/v1/admin/profile", nil)
	if strings.Contains(prof, testSteamKey) {
		t.Fatal("profile leaks the key")
	}
}

func TestLibraryNeedsAdmin(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/api/v1/admin/import/steam-library", "/api/v1/admin/import/anilist-list?user=x&type=anime"} {
		if res, _ := e.do("GET", p, nil); res.StatusCode != 401 {
			t.Fatalf("%s without login: %d", p, res.StatusCode)
		}
	}
	if res, _ := e.do("POST", "/api/v1/admin/import/bulk", map[string]any{"kind": "games", "items": []any{}}); res.StatusCode != 401 {
		t.Fatalf("bulk without login: %d", res.StatusCode)
	}
}

func TestAniListListPreviewAndDedupe(t *testing.T) {
	e := newEnv(t)
	e.login()
	var gotUser, gotType string
	e.app.library.aniList = func(user, typ string) ([]services.LibraryItem, error) {
		gotUser, gotType = user, typ
		return []services.LibraryItem{
			{AniListID: 1, Title: "One", Type: "anime", Status: "playing", Progress: "3/12 ep"},
			{AniListID: 2, Title: "Two", Type: "anime", Status: "completed", Rating: "9/10"},
			{AniListID: 3, Title: "Three", Type: "anime", Status: "wishlist"},
			{AniListID: 4, Title: "Four", Type: "anime", Status: "dropped"},
		}, nil
	}
	for _, bad := range []string{"", "?user=x", "?user=x&type=music", "?user=bad%20name&type=anime"} {
		if res, _ := e.do("GET", "/api/v1/admin/import/anilist-list"+bad, nil); res.StatusCode != 400 {
			t.Fatalf("query %q: %d", bad, res.StatusCode)
		}
	}
	rows := e.preview("/api/v1/admin/import/anilist-list?user=someone&type=anime")
	if gotUser != "someone" || gotType != "ANIME" || len(rows) != 4 || rows[0].Status != "playing" || rows[3].Status != "dropped" {
		t.Fatalf("preview: %s %s %+v", gotUser, gotType, rows)
	}
	// An entry saved by hand with the same AniList id counts as existing.
	e.do("POST", "/api/v1/admin/media", map[string]any{"title": "Hand made", "type": "anime", "anilist_id": 4})

	add := func(ids ...int) string {
		items := []map[string]any{}
		for _, id := range ids {
			items = append(items, map[string]any{"anilist_id": id, "title": fmt.Sprintf("T%d", id), "type": "anime", "status": "completed", "cover_image": "https://example.com/x.jpg"})
		}
		res, body := e.do("POST", "/api/v1/admin/import/bulk", map[string]any{"kind": "media", "items": items})
		if res.StatusCode != 200 {
			t.Fatalf("bulk: %d %s", res.StatusCode, body)
		}
		return body
	}
	if out := add(1, 2, 3, 4); !strings.Contains(out, `"added":3`) || !strings.Contains(out, `"skipped":1`) {
		t.Fatalf("first: %s", out)
	}
	if out := add(1, 2, 3); !strings.Contains(out, `"added":0`) || !strings.Contains(out, `"skipped":3`) {
		t.Fatalf("second: %s", out)
	}
	_, media := e.do("GET", "/api/v1/admin/media", nil)
	if strings.Count(media, `"anilist_id":`) != 4 {
		t.Fatalf("media: %s", media)
	}
	rows = e.preview("/api/v1/admin/import/anilist-list?user=someone&type=anime")
	for _, r := range rows {
		if !r.Exists {
			t.Fatalf("not marked existing: %+v", r)
		}
	}
}

func TestBulkValidation(t *testing.T) {
	e := newEnv(t)
	e.login()
	post := func(body any) (int, string) {
		res, out := e.do("POST", "/api/v1/admin/import/bulk", body)
		return res.StatusCode, out
	}
	game := func(i int) map[string]any { return map[string]any{"steam_appid": i, "title": fmt.Sprintf("G%d", i)} }

	// 500 is the limit.
	many := make([]map[string]any, 0, 501)
	for i := 1; i <= 500; i++ {
		many = append(many, game(i))
	}
	if code, out := post(map[string]any{"kind": "games", "items": many}); code != 200 || !strings.Contains(out, `"added":500`) {
		t.Fatalf("500 items: %d %s", code, out)
	}
	many = append(many, game(501))
	if code, out := post(map[string]any{"kind": "games", "items": many}); code != 400 || !strings.Contains(out, "at most 500") {
		t.Fatalf("501 items: %d %s", code, out)
	}
	_, games := e.do("GET", "/api/v1/admin/games", nil)
	if strings.Contains(games, `"G501"`) {
		t.Fatal("over-limit request added items")
	}

	// Bad input is rejected as a whole and adds nothing.
	for name, body := range map[string]map[string]any{
		"empty":       {"kind": "games", "items": []any{}},
		"kind":        {"kind": "cases", "items": []any{game(1)}},
		"status":      {"kind": "games", "items": []any{map[string]any{"steam_appid": 900, "title": "X", "status": "nope"}}},
		"no appid":    {"kind": "games", "items": []any{map[string]any{"title": "X"}}},
		"cover":       {"kind": "games", "items": []any{map[string]any{"steam_appid": 900, "title": "X", "cover_image": "javascript:alert(1)"}}},
		"media state": {"kind": "media", "items": []any{map[string]any{"anilist_id": 900, "title": "X", "type": "anime", "status": "nope"}}},
		"media type":  {"kind": "media", "items": []any{map[string]any{"anilist_id": 900, "title": "X", "type": "film"}}},
		"no anilist":  {"kind": "media", "items": []any{map[string]any{"title": "X", "type": "anime"}}},
		"mixed":       {"kind": "games", "items": []any{game(901), map[string]any{"steam_appid": 902, "title": "Y", "status": "nope"}}},
	} {
		if code, out := post(body); code != 400 {
			t.Fatalf("%s: %d %s", name, code, out)
		}
	}
	_, games = e.do("GET", "/api/v1/admin/games", nil)
	if strings.Contains(games, `"G901"`) || strings.Contains(games, `"X"`) {
		t.Fatal("rejected request added items")
	}
	if code, out := post(map[string]any{"kind": "games", "items": []any{map[string]any{"steam_appid": 903, "title": "Bad", "status": "nope"}}}); code != 400 || !strings.Contains(out, "items[0].status") {
		t.Fatalf("field path: %d %s", code, out)
	}
}

func TestSteamAppIDExportRestore(t *testing.T) {
	e := newEnv(t)
	e.login()
	res, body := e.do("POST", "/api/v1/admin/games", map[string]any{"title": "Linked", "steam_appid": 4242})
	if res.StatusCode != 201 || !strings.Contains(body, `"steam_appid":4242`) {
		t.Fatalf("create: %d %s", res.StatusCode, body)
	}
	if res, _ := e.do("POST", "/api/v1/admin/games", map[string]any{"title": "Bad", "steam_appid": -1}); res.StatusCode != 400 {
		t.Fatalf("negative app id: %d", res.StatusCode)
	}
	_, exp := e.do("GET", "/api/v1/admin/export", nil)
	if !strings.Contains(exp, `"steam_appid":4242`) {
		t.Fatalf("export: %s", exp)
	}
	var data map[string]any
	json.Unmarshal([]byte(exp), &data)
	e.do("DELETE", "/api/v1/admin/games/1", nil)
	if res, body := e.do("POST", "/api/v1/admin/restore", data); res.StatusCode != 200 {
		t.Fatalf("restore: %d %s", res.StatusCode, body)
	}
	if _, games := e.do("GET", "/api/v1/admin/games", nil); !strings.Contains(games, `"steam_appid":4242`) {
		t.Fatalf("after restore: %s", games)
	}
	// An export from before the field restores as 0.
	data["games"] = []map[string]any{{"id": 1, "title": "Old"}}
	if res, body := e.do("POST", "/api/v1/admin/restore", data); res.StatusCode != 200 {
		t.Fatalf("old restore: %d %s", res.StatusCode, body)
	}
	if _, games := e.do("GET", "/api/v1/admin/games", nil); !strings.Contains(games, `"steam_appid":0`) {
		t.Fatalf("old export: %s", games)
	}
}
