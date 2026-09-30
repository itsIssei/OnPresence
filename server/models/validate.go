package models

import (
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func IsHexColor(s string) bool { return hexColor.MatchString(s) }

// IsSafeURL accepts https URLs and local /uploads/ or /img/ paths. Empty is
// allowed (means "unset"). Everything else (javascript:, data:, http:) fails.
func IsSafeURL(s string) bool {
	if s == "" {
		return true
	}
	if strings.HasPrefix(s, "/uploads/") || strings.HasPrefix(s, "/img/") {
		return !strings.Contains(s, "..") && !strings.ContainsAny(s, "\"'<>\\ ")
	}
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil
}

var sitePath = regexp.MustCompile(`^/[A-Za-z0-9._~\-/?=&%#+]*$`)

// IsLinkURL is IsSafeURL plus mailto: and same-site paths (e.g. /tools/app)
// for links and projects. Protocol-relative "//host" is rejected.
func IsLinkURL(s string) bool {
	if strings.HasPrefix(s, "mailto:") && len(s) > 7 && !strings.ContainsAny(s, "\"'<> ") {
		return true
	}
	if strings.HasPrefix(s, "/") && !strings.HasPrefix(s, "//") && !strings.Contains(s, "..") && sitePath.MatchString(s) {
		return true
	}
	return s != "" && IsSafeURL(s)
}

func oneOf(v string, allowed []string, def string) string {
	if contains(allowed, v) {
		return v
	}
	return def
}

// OneOf is the exported form used by the API layer.
func OneOf(v string, allowed []string, def string) string { return oneOf(v, allowed, def) }

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func clampI(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampF(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n])
}

// Truncate trims whitespace and limits s to n runes.
func Truncate(s string, n int) string { return truncate(s, n) }
