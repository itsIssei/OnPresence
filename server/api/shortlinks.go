package api

import (
	"crypto/rand"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"onpresence/server/models"
	"onpresence/server/store"
)

// Short links: <domain>/<slug> redirects to a saved URL. Only the signed-in
// admin can create them, so the domain cannot be used as an open redirector.

var slugFmt = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)

// reservedSlugs are the first path segments the app itself serves; a short
// link with one of these names would never be reached (or would shadow a
// page). When you add a top-level route, page or public file, add its first
// path segment (without extension) here.
var reservedSlugs = map[string]bool{
	"admin": true, "api": true, "vault": true, "go": true, "uploads": true,
	"img": true, "assets": true, "data": true, "healthz": true, "og": true,
	"index": true, "robots": true, "manifest": true, "favicon": true,
}

// No look-alike characters (0/o, 1/l), so random slugs are easy to read out.
const slugAlphabet = "abcdefghijkmnpqrstuvwxyz23456789"

func randomSlug(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = slugAlphabet[int(b[i])%len(slugAlphabet)]
	}
	return string(b)
}

// validateShortLink checks and normalizes x. An empty slug is allowed here;
// saveShortLink replaces it with a random one.
func validateShortLink(v validationError, x *models.ShortLink) {
	x.Slug = strings.ToLower(strings.Trim(strings.TrimSpace(x.Slug), "/"))
	text(v, "note", &x.Note, 0, 120)
	switch {
	case x.Slug == "":
	case !slugFmt.MatchString(x.Slug):
		v.add("slug", "Use letters, digits, - and _ (up to 32)")
	case reservedSlugs[x.Slug]:
		v.add("slug", "This name is used by the site itself")
	}
	x.URL = strings.TrimSpace(x.URL)
	switch {
	case !models.IsLinkURL(x.URL) || x.URL == "/":
		v.add("url", "Use an https:// link")
	case x.Slug != "" && strings.EqualFold(x.URL, "/"+x.Slug):
		v.add("url", "A short link cannot point to itself")
	}
}

// saveShortLink stores x. An empty slug gets a random one (retried if taken).
// A taken slug is reported through v.
func (s *Server) saveShortLink(r *http.Request, v validationError, x *models.ShortLink) error {
	if x.Slug != "" {
		err := s.store.SaveShortLink(r.Context(), x)
		if errors.Is(err, store.ErrSlugTaken) {
			v.add("slug", "This name is already in use")
			return nil
		}
		return err
	}
	for range 8 {
		x.Slug = randomSlug(4)
		if reservedSlugs[x.Slug] {
			continue
		}
		err := s.store.SaveShortLink(r.Context(), x)
		if !errors.Is(err, store.ErrSlugTaken) {
			return err
		}
	}
	return errors.New("could not find a free short link name")
}

// shortRedirect handles /<slug>. It reports false when p is not a known,
// active short link, so the caller can fall back to the page.
func (s *Server) shortRedirect(w http.ResponseWriter, r *http.Request, p string) bool {
	slug := strings.ToLower(p)
	if !slugFmt.MatchString(slug) || reservedSlugs[slug] {
		return false
	}
	target, err := s.store.ShortLinkClick(r.Context(), slug)
	if err != nil || !models.IsLinkURL(target) {
		return false
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
	http.Redirect(w, r, target, http.StatusFound)
	return true
}
