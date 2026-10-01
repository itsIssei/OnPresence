package api

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"onpresence/server/config"
	"onpresence/server/store"
	"onpresence/server/totp"
)

const testPassword = "correct-horse-battery"

type env struct {
	t   *testing.T
	srv *httptest.Server
	c   *http.Client
	cfg config.Config
}

func newEnv(t *testing.T) *env {
	t.Helper()
	dir := t.TempDir()
	cfg := config.Config{DataDir: dir, DBPath: filepath.Join(dir, "t.db"), SessionTTL: time.Hour, AdminUser: "admin"}
	ctx := context.Background()
	st, err := store.Open(ctx, cfg.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.BootstrapAdmin(ctx, "admin", testPassword, false); err != nil {
		t.Fatal(err)
	}
	web := fstest.MapFS{
		"index.html":            {Data: []byte("<html><head><title>OnPresence</title><!--app-head--></head></html>")},
		"admin.html":            {Data: []byte("admin")},
		"assets/app-abc.js":     {Data: []byte("js")},
		"data/decorations.json": {Data: []byte(`[{"id":"orbit","url":"/img/decorations/orbit.png"}]`)},
		"data/effects.json":     {Data: []byte(`[{"id":"starfall","effects":[{"src":"/img/effects/starfall.png"}]}]`)},
	}
	s, err := New(cfg, st, web)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	return &env{t: t, srv: srv, c: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, cfg: cfg}
}

func (e *env) do(method, path string, body any, hdr ...string) (*http.Response, string) {
	e.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, r)
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	res, err := e.c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

func (e *env) login() {
	e.t.Helper()
	res, body := e.do("POST", "/api/v1/auth/login", map[string]string{"username": "admin", "password": testPassword})
	if res.StatusCode != 200 {
		e.t.Fatalf("login: %d %s", res.StatusCode, body)
	}
}

func TestAdminRequiresAuth(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/api/v1/admin/profile", "/api/v1/admin/games", "/api/v1/admin/import/music?url=https://youtu.be/x", "/api/v1/auth/me"} {
		if res, _ := e.do("GET", p, nil); res.StatusCode != 401 {
			t.Errorf("%s: %d", p, res.StatusCode)
		}
	}
	e.login()
	if res, _ := e.do("GET", "/api/v1/admin/profile", nil); res.StatusCode != 200 {
		t.Fatalf("after login: %d", res.StatusCode)
	}
	e.do("POST", "/api/v1/auth/logout", nil)
	if res, _ := e.do("GET", "/api/v1/admin/profile", nil); res.StatusCode != 401 {
		t.Fatal("session survived logout")
	}
}

func TestLoginRateLimit(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < 5; i++ {
		e.do("POST", "/api/v1/auth/login", map[string]string{"username": "admin", "password": "wrong"})
	}
	res, _ := e.do("POST", "/api/v1/auth/login", map[string]string{"username": "admin", "password": testPassword}, "X-Forwarded-For", "9.9.9.9")
	if res.StatusCode != 429 {
		t.Fatalf("expected 429 even with spoofed XFF, got %d", res.StatusCode)
	}
}

func TestCSRFBlocked(t *testing.T) {
	e := newEnv(t)
	e.login()
	res, _ := e.do("POST", "/api/v1/admin/games", map[string]any{"title": "x"}, "Sec-Fetch-Site", "cross-site")
	if res.StatusCode != 403 {
		t.Fatalf("cross-site write: %d", res.StatusCode)
	}
}

func TestProfileValidation(t *testing.T) {
	e := newEnv(t)
	e.login()
	_, body := e.do("GET", "/api/v1/admin/profile", nil)
	var p map[string]any
	json.Unmarshal([]byte(body), &p)
	if _, leaked := p["steam_api_key"]; leaked {
		t.Fatal("steam key returned")
	}

	p["avatar_url"] = "javascript:alert(1)"
	res, body := e.do("PUT", "/api/v1/admin/profile", p)
	if res.StatusCode != 400 || !strings.Contains(body, "avatar_url") {
		t.Fatalf("unsafe url accepted: %d %s", res.StatusCode, body)
	}

	p["avatar_url"] = "/uploads/abc.png"
	p["name"] = "Nova <script>"
	p["steam_api_key"] = "0123456789ABCDEF0123456789ABCDEF"
	settings := p["settings"].(map[string]any)
	settings["avatar_decoration"] = "https://example.com/decorations/a_1.png"
	settings["profile_effect"] = "1541465731583971358"
	settings["card_opacity"] = 7
	res, body = e.do("PUT", "/api/v1/admin/profile", p)
	if res.StatusCode != 200 {
		t.Fatalf("save: %d %s", res.StatusCode, body)
	}
	if !strings.Contains(body, `"steam_api_key_set":true`) || !strings.Contains(body, `"card_opacity":1`) {
		t.Fatalf("unexpected: %s", body)
	}

	// Public profile + meta injection is escaped and never exposes the key.
	_, pub := e.do("GET", "/api/v1/profile", nil)
	if strings.Contains(pub, "0123456789ABCDEF") || !strings.Contains(pub, "a_1.png") {
		t.Fatalf("public profile: %s", pub)
	}
	_, page := e.do("GET", "/", nil)
	if strings.Contains(page, "<script>") || !strings.Contains(page, "Nova &lt;script&gt;") {
		t.Fatalf("meta not escaped: %s", page)
	}
}

func TestCollectionsCRUD(t *testing.T) {
	e := newEnv(t)
	e.login()
	res, body := e.do("POST", "/api/v1/admin/games", map[string]any{"title": "Elden Ring", "cover_image": "https://x.test/a.jpg", "badge_type": "weird"})
	if res.StatusCode != 201 || !strings.Contains(body, `"badge_type":"good"`) {
		t.Fatalf("create: %d %s", res.StatusCode, body)
	}
	var g struct{ ID int64 }
	json.Unmarshal([]byte(body), &g)
	if res, _ := e.do("PUT", "/api/v1/admin/games/999", map[string]any{"title": "x"}); res.StatusCode != 404 {
		t.Fatalf("update missing: %d", res.StatusCode)
	}
	if res, _ := e.do("POST", "/api/v1/admin/links", map[string]any{"label": "x", "url": "javascript:alert(1)"}); res.StatusCode != 400 {
		t.Fatal("bad link accepted")
	}
	res, body = e.do("POST", "/api/v1/admin/playlists", map[string]any{"title": "Phonk", "tracks": []map[string]string{{"title": "a"}, {"title": "b"}}})
	if res.StatusCode != 201 || strings.Count(body, `"title"`) != 3 {
		t.Fatalf("playlist: %s", body)
	}
	_, vault := e.do("GET", "/api/v1/vault", nil)
	if !strings.Contains(vault, "Elden Ring") || !strings.Contains(vault, `"games":1`) {
		t.Fatalf("vault: %s", vault)
	}
	if res, _ := e.do("DELETE", "/api/v1/admin/games/"+itoa(g.ID), nil); res.StatusCode != 200 {
		t.Fatal("delete")
	}
}

func TestLinkRedirectCountsClicks(t *testing.T) {
	e := newEnv(t)
	res, _ := e.do("GET", "/go/1", nil) // seeded GitHub link
	if res.StatusCode != 302 || res.Header.Get("Location") != "https://github.com" {
		t.Fatalf("redirect: %d %s", res.StatusCode, res.Header.Get("Location"))
	}
	e.login()
	_, stats := e.do("GET", "/api/v1/admin/stats", nil)
	if !strings.Contains(stats, `"link_clicks":1`) {
		t.Fatalf("stats: %s", stats)
	}
}

func TestViewsDedupe(t *testing.T) {
	e := newEnv(t)
	e.do("POST", "/api/v1/view", nil)
	_, b := e.do("POST", "/api/v1/view", nil)
	if !strings.Contains(b, `"views":1`) {
		t.Fatalf("views: %s", b)
	}
}

func TestCatalogAndStatic(t *testing.T) {
	e := newEnv(t)
	res, body := e.do("GET", "/data/decorations.json", nil)
	if res.StatusCode != 200 || !strings.Contains(body, "orbit") {
		t.Fatalf("bundled catalog: %d %s", res.StatusCode, body)
	}
	if res, _ := e.do("GET", "/data/..%2f..%2fgo.mod", nil); res.StatusCode != 404 {
		t.Fatalf("traversal: %d", res.StatusCode)
	}
	e.login()
	e.do("POST", "/api/v1/admin/catalog", map[string]any{"decorations": []map[string]string{
		{"id": "synced-one", "url": "https://example.com/a.png"},
		{"id": "../bad"},
		{"id": "script-url", "url": "javascript:alert(1)"},
	}})
	_, body = e.do("GET", "/data/decorations.json", nil)
	if !strings.Contains(body, "synced-one") || strings.Contains(body, "bad") || strings.Contains(body, "script-url") {
		t.Fatalf("synced catalog: %s", body)
	}
	e.do("DELETE", "/api/v1/admin/catalog", nil)
	if _, body = e.do("GET", "/data/decorations.json", nil); !strings.Contains(body, "orbit") {
		t.Fatalf("reset catalog: %s", body)
	}
	res, _ = e.do("GET", "/assets/app-abc.js", nil)
	if !strings.Contains(res.Header.Get("Cache-Control"), "immutable") {
		t.Fatal("assets not immutable")
	}
	res, body = e.do("GET", "/vault", nil)
	if res.StatusCode != 200 || !strings.Contains(body, "<html>") {
		t.Fatal("spa fallback")
	}
	if res, _ := e.do("GET", "/missing.js", nil); res.StatusCode != 404 {
		t.Fatal("missing asset should 404")
	}
}

func TestUploads(t *testing.T) {
	e := newEnv(t)
	e.login()

	// HTML disguised as PNG is rejected.
	if res, _ := e.upload("evil.png", []byte("<html><script>alert(1)</script>")); res.StatusCode != 400 {
		t.Fatalf("html upload: %d", res.StatusCode)
	}

	img := image.NewRGBA(image.Rect(0, 0, 3000, 1000))
	img.Set(1, 1, color.White)
	var buf bytes.Buffer
	png.Encode(&buf, img)
	res, body := e.upload("big.png", buf.Bytes())
	if res.StatusCode != 201 || !strings.Contains(body, `"width":2048`) {
		t.Fatalf("png upload: %d %s", res.StatusCode, body)
	}
	var up struct {
		ID  int64
		URL string
	}
	json.Unmarshal([]byte(body), &up)
	res, _ = e.do("GET", up.URL, nil)
	if res.StatusCode != 200 || !strings.Contains(res.Header.Get("Content-Security-Policy"), "sandbox") {
		t.Fatalf("serve upload: %d %v", res.StatusCode, res.Header)
	}

	// In use by the profile: delete refused without force.
	e.putAvatar(up.URL)
	if res, _ := e.do("DELETE", "/api/v1/admin/uploads/"+itoa(up.ID), nil); res.StatusCode != 409 {
		t.Fatalf("in-use delete: %d", res.StatusCode)
	}
	if res, _ := e.do("DELETE", "/api/v1/admin/uploads/"+itoa(up.ID)+"?force=1", nil); res.StatusCode != 200 {
		t.Fatalf("force delete: %d", res.StatusCode)
	}
}

func (e *env) upload(name string, data []byte) (*http.Response, string) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", name)
	fw.Write(data)
	mw.Close()
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/v1/admin/uploads", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	res, err := e.c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

func (e *env) putAvatar(url string) {
	_, body := e.do("GET", "/api/v1/admin/profile", nil)
	var p map[string]any
	json.Unmarshal([]byte(body), &p)
	p["avatar_url"] = url
	if res, b := e.do("PUT", "/api/v1/admin/profile", p); res.StatusCode != 200 {
		e.t.Fatalf("put avatar: %s", b)
	}
}

func TestPresenceIgnoresQueryID(t *testing.T) {
	e := newEnv(t)
	_, body := e.do("GET", "/api/v1/presence?id=76561197960287930", nil)
	if strings.Contains(body, "76561197960287930") {
		t.Fatal("presence used query id")
	}
}

func itoa(n int64) string { return jsonNum(n) }

func jsonNum(n int64) string { b, _ := json.Marshal(n); return string(b) }

func TestProjectsInReferrals(t *testing.T) {
	e := newEnv(t)
	e.login()
	res, body := e.do("POST", "/api/v1/admin/referrals", map[string]any{"kind": "project", "title": "My tools", "ref_url": "/tools"})
	if res.StatusCode != 201 || !strings.Contains(body, `"kind":"project"`) {
		t.Fatalf("create project: %d %s", res.StatusCode, body)
	}
	if res, _ := e.do("POST", "/api/v1/admin/referrals", map[string]any{"title": "x", "ref_url": "//evil.com"}); res.StatusCode != 400 {
		t.Fatal("protocol-relative url accepted")
	}
	_, vault := e.do("GET", "/api/v1/vault", nil)
	if !strings.Contains(vault, "My tools") {
		t.Fatalf("vault: %s", vault)
	}
}

func TestFirstRunSetup(t *testing.T) {
	dir := t.TempDir()
	cfg := config.Config{DataDir: dir, DBPath: filepath.Join(dir, "t.db"), SessionTTL: time.Hour}
	st, err := store.Open(context.Background(), cfg.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	s, err := New(cfg, st, fstest.MapFS{})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	e := &env{t: t, srv: srv, c: &http.Client{Jar: jar}, cfg: cfg}

	if _, body := e.do("GET", "/api/v1/setup", nil); !strings.Contains(body, `"needed":true`) {
		t.Fatalf("setup status: %s", body)
	}
	if res, _ := e.do("POST", "/api/v1/setup", map[string]string{"setup_code": "wrong", "username": "owner", "password": "long-enough-pw"}); res.StatusCode != 403 {
		t.Fatalf("wrong code: %d", res.StatusCode)
	}
	code := *s.setupCode.Load()
	if res, body := e.do("POST", "/api/v1/setup", map[string]string{"setup_code": code, "username": "x", "password": "short"}); res.StatusCode != 400 || !strings.Contains(body, "username") {
		t.Fatalf("validation: %d %s", res.StatusCode, body)
	}
	if res, body := e.do("POST", "/api/v1/setup", map[string]string{"setup_code": code, "username": "owner", "password": "long-enough-pw"}); res.StatusCode != 200 {
		t.Fatalf("setup: %d %s", res.StatusCode, body)
	}
	if res, _ := e.do("GET", "/api/v1/auth/me", nil); res.StatusCode != 200 {
		t.Fatal("not signed in after setup")
	}
	if res, _ := e.do("POST", "/api/v1/setup", map[string]string{"setup_code": code, "username": "evil", "password": "long-enough-pw"}); res.StatusCode != 403 {
		t.Fatalf("setup ran twice: %d", res.StatusCode)
	}
}

func TestLoginWithTOTP(t *testing.T) {
	e := newEnv(t)
	e.login()
	_, body := e.do("POST", "/api/v1/auth/totp/setup", nil)
	var begin struct{ Secret, URI string }
	json.Unmarshal([]byte(body), &begin)
	if begin.Secret == "" || !strings.HasPrefix(begin.URI, "otpauth://totp/") {
		t.Fatalf("setup: %s", body)
	}
	prev, _ := totp.Code(begin.Secret, totp.Step(time.Now())-1)
	if res, body := e.do("POST", "/api/v1/auth/totp/enable", map[string]string{"code": prev}); res.StatusCode != 200 || !strings.Contains(body, "recovery_codes") {
		t.Fatalf("enable: %d %s", res.StatusCode, body)
	}
	e.do("POST", "/api/v1/auth/logout", nil)

	creds := map[string]string{"username": "admin", "password": testPassword}
	res, body := e.do("POST", "/api/v1/auth/login", creds)
	if res.StatusCode != 401 || !strings.Contains(body, "totp_required") {
		t.Fatalf("password alone: %d %s", res.StatusCode, body)
	}
	creds["code"] = "000000"
	if res, _ := e.do("POST", "/api/v1/auth/login", creds); res.StatusCode != 401 {
		t.Fatal("wrong code accepted")
	}
	creds["code"], _ = totp.Code(begin.Secret, totp.Step(time.Now()))
	if res, body := e.do("POST", "/api/v1/auth/login", creds); res.StatusCode != 200 {
		t.Fatalf("login with code: %d %s", res.StatusCode, body)
	}
	if res, _ := e.do("POST", "/api/v1/auth/totp/disable", map[string]string{"password": "wrong"}); res.StatusCode != 400 {
		t.Fatal("disabled without password")
	}
}

func TestExportRestore(t *testing.T) {
	e := newEnv(t)
	e.login()
	e.do("POST", "/api/v1/admin/games", map[string]any{"title": "Kept"})
	_, body := e.do("GET", "/api/v1/admin/export", nil)
	var exp map[string]any
	json.Unmarshal([]byte(body), &exp)
	if exp["app"] != "onpresence" {
		t.Fatalf("export: %s", body)
	}
	exp["games"] = []map[string]any{{"id": 1, "title": "A"}, {"id": 1, "title": "B"}}
	if res, body := e.do("POST", "/api/v1/admin/restore", exp); res.StatusCode != 200 {
		t.Fatalf("restore: %d %s", res.StatusCode, body)
	}
	_, games := e.do("GET", "/api/v1/admin/games", nil)
	if !strings.Contains(games, `"A"`) || !strings.Contains(games, `"B"`) || strings.Contains(games, "Kept") {
		t.Fatalf("games after restore: %s", games)
	}
	exp["games"] = []map[string]any{{"title": "bad", "cover_image": "javascript:alert(1)"}}
	if res, body := e.do("POST", "/api/v1/admin/restore", exp); res.StatusCode != 400 || !strings.Contains(body, "games[0].cover_image") {
		t.Fatalf("invalid restore: %d %s", res.StatusCode, body)
	}
	if res, _ := e.do("POST", "/api/v1/admin/restore", map[string]any{"app": "other", "version": 1}); res.StatusCode != 400 {
		t.Fatal("foreign file accepted")
	}
}

func TestOGImage(t *testing.T) {
	e := newEnv(t)
	res, body := e.do("GET", "/og.png", nil)
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" || !strings.HasPrefix(body, pngMagic) {
		t.Fatalf("og: %d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
	_, page := e.do("GET", "/", nil)
	if !strings.Contains(page, "/og.png?v=") || !strings.Contains(page, "summary_large_image") {
		t.Fatalf("og meta: %s", page)
	}
}

var pngMagic = string([]byte{0x89, 'P', 'N', 'G'})

func TestCopyTextLink(t *testing.T) {
	e := newEnv(t)
	e.login()
	res, body := e.do("POST", "/api/v1/admin/links", map[string]any{"label": "Discord", "icon": "discord", "copy_text": "@nova", "url": "https://ignored.example"})
	if res.StatusCode != 201 || !strings.Contains(body, `"copy_text":"@nova"`) || !strings.Contains(body, `"url":""`) {
		t.Fatalf("create: %d %s", res.StatusCode, body)
	}
	var link struct{ ID int64 }
	json.Unmarshal([]byte(body), &link)
	// A click is counted but nothing is opened.
	if res, _ := e.do("GET", "/go/"+jsonNum(link.ID), nil); res.StatusCode != 204 || res.Header.Get("Location") != "" {
		t.Fatalf("copy link click: %d", res.StatusCode)
	}
	if _, pub := e.do("GET", "/api/v1/profile", nil); !strings.Contains(pub, `"copy_text":"@nova"`) {
		t.Fatalf("public profile: %s", pub)
	}
	// Neither a URL nor text: rejected.
	if res, _ := e.do("POST", "/api/v1/admin/links", map[string]any{"label": "Empty", "url": ""}); res.StatusCode != 400 {
		t.Fatalf("empty link accepted: %d", res.StatusCode)
	}
}
