package api

import (
	"bytes"
	"html"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

var startTime = time.Now()

// serveWeb serves the built frontend. Hashed files under /assets/ are cached
// forever; HTML is always revalidated. Unknown paths fall back to the SPA
// shell (index.html or admin.html).
func (s *Server) serveWeb(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")

	if p == "admin" || strings.HasPrefix(p, "admin/") {
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		s.serveWebFile(w, r, "admin.html", "no-cache")
		return
	}
	if p == "" || p == "." || p == "index.html" {
		s.serveIndex(w, r)
		return
	}
	if p == "admin.html" {
		http.Redirect(w, r, "/admin", http.StatusMovedPermanently)
		return
	}

	if fi, err := fs.Stat(s.web, p); err == nil && !fi.IsDir() {
		cache := "public, max-age=86400"
		if strings.HasPrefix(p, "assets/") {
			cache = "public, max-age=31536000, immutable"
		}
		s.serveWebFile(w, r, p, cache)
		return
	}
	if strings.Contains(path.Base(p), ".") {
		http.NotFound(w, r)
		return
	}
	s.serveIndex(w, r)
}

func (s *Server) serveWebFile(w http.ResponseWriter, r *http.Request, name, cache string) {
	b, err := fs.ReadFile(s.web, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	mod := startTime
	if fi, err := fs.Stat(s.web, name); err == nil && !fi.ModTime().IsZero() {
		mod = fi.ModTime()
	}
	if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", cache)
	http.ServeContent(w, r, name, mod, bytes.NewReader(b))
}

// serveIndex renders index.html with SEO and OpenGraph tags from the profile.
func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	page, err := fs.ReadFile(s.web, "index.html")
	if err != nil {
		http.Error(w, "frontend not built", http.StatusServiceUnavailable)
		return
	}
	if p, _, err := s.store.Profile(r.Context()); err == nil {
		page = injectMeta(page, p.Name, p.Title, p.Bio, "/og.png?v="+ogVersion(p), p.Settings.AccentColor, s.baseURL(r))
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(page)
}

func (s *Server) baseURL(r *http.Request) string {
	if s.cfg.PublicURL != "" {
		return s.cfg.PublicURL
	}
	if s.isHTTPS(r) {
		return "https://" + r.Host
	}
	return "http://" + r.Host
}

func injectMeta(page []byte, name, title, bio, image, color, base string) []byte {
	full := name
	if title != "" {
		full += " · " + title
	}
	desc := []rune(bio)
	if len(desc) > 200 {
		desc = desc[:200]
	}
	if strings.HasPrefix(image, "/") {
		image = base + image
	}
	e := html.EscapeString
	tags := []string{
		`<title>` + e(full) + `</title>`,
		`<meta name="description" content="` + e(string(desc)) + `">`,
		`<link rel="canonical" href="` + e(base+"/") + `">`,
		`<meta property="og:type" content="profile">`,
		`<meta property="og:title" content="` + e(full) + `">`,
		`<meta property="og:description" content="` + e(string(desc)) + `">`,
		`<meta property="og:url" content="` + e(base+"/") + `">`,
		`<meta name="twitter:card" content="summary_large_image">`,
		`<meta name="theme-color" content="` + e(color) + `">`,
	}
	if image != "" {
		tags = append(tags,
			`<meta property="og:image" content="`+e(image)+`">`,
			`<meta property="og:image:width" content="1200">`,
			`<meta property="og:image:height" content="630">`,
			`<meta name="twitter:image" content="`+e(image)+`">`)
	}
	page = bytes.Replace(page, []byte("<title>OnPresence</title>"), nil, 1)
	return bytes.Replace(page, []byte("<!--app-head-->"), []byte(strings.Join(tags, "")), 1)
}
