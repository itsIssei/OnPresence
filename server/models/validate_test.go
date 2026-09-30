package models

import "testing"

func TestIsLinkURL(t *testing.T) {
	ok := []string{"https://example.com/tools", "/tools/app", "/tools/app?x=1", "mailto:me@example.com", "/"}
	bad := []string{"", "//evil.com", "/\\evil.com", "javascript:alert(1)", "http://x.com", "/a/../b", "/a b", "data:text/html,1"}
	for _, u := range ok {
		if !IsLinkURL(u) {
			t.Errorf("%q should be allowed", u)
		}
	}
	for _, u := range bad {
		if IsLinkURL(u) {
			t.Errorf("%q should be rejected", u)
		}
	}
}
