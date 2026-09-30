package totp

import (
	"encoding/base32"
	"testing"
	"time"
)

// RFC 6238 appendix B test vectors (SHA-1, truncated to 6 digits).
func TestRFCVectors(t *testing.T) {
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte("12345678901234567890"))
	cases := map[int64]string{59: "287082", 1111111109: "081804", 1234567890: "005924", 2000000000: "279037"}
	for ts, want := range cases {
		got, err := Code(secret, Step(time.Unix(ts, 0)))
		if err != nil || got != want {
			t.Errorf("t=%d: got %s want %s (%v)", ts, got, want, err)
		}
	}
}

func TestVerifySkew(t *testing.T) {
	s := NewSecret()
	now := time.Unix(1_700_000_000, 0)
	prev, _ := Code(s, Step(now)-1)
	if _, ok := Verify(s, prev, now); !ok {
		t.Fatal("previous step should be accepted")
	}
	old, _ := Code(s, Step(now)-3)
	if _, ok := Verify(s, old, now); ok {
		t.Fatal("old code accepted")
	}
	if _, ok := Verify(s, "12345", now); ok {
		t.Fatal("short code accepted")
	}
}
