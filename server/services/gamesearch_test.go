package services

import "testing"

func TestAppIDInput(t *testing.T) {
	cases := map[string]string{
		"1245620": "",
		"https://store.steampowered.com/app/1245620/ELDEN_RING/": "1245620",
		"https://steamdb.info/app/1245620/":                      "1245620",
	}
	for in, want := range cases {
		m := appIDInput.FindStringSubmatch(in)
		if m == nil || m[1] != want {
			t.Errorf("%q: got %v", in, m)
		}
	}
	for _, bad := range []string{"elden ring", "https://evil.com/app/1", "http://steamdb.info.evil.com/app/1"} {
		if appIDInput.MatchString(bad) {
			t.Errorf("%q should not match", bad)
		}
	}
}
