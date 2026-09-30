package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"onpresence/server/models"
	"onpresence/server/totp"
)

func TestFreshDBSeedAndAdmin(t *testing.T) {
	ctx := context.Background()
	st, err := Open(ctx, filepath.Join(t.TempDir(), "x.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	p, _, err := st.Profile(ctx)
	if err != nil || p.Name == "" {
		t.Fatalf("seed: %v %+v", err, p)
	}
	if err := st.BootstrapAdmin(ctx, "admin", "", false); err != nil {
		t.Fatal(err)
	}
	if has, _ := st.HasAdmin(ctx); has {
		t.Fatal("empty ADMIN_PASSWORD must leave setup to the dashboard")
	}
	if err := st.BootstrapAdmin(ctx, "admin", "short", false); err == nil {
		t.Fatal("short password accepted")
	}
	if err := st.BootstrapAdmin(ctx, "admin", "correct-horse-1", false); err != nil {
		t.Fatal(err)
	}
	// Existing admin: env password ignored without reset.
	if err := st.BootstrapAdmin(ctx, "admin", "other-password-2", false); err != nil {
		t.Fatal(err)
	}
	if st.CheckPassword(ctx, "admin", "correct-horse-1") != nil {
		t.Fatal("password was overwritten")
	}
	if st.CheckPassword(ctx, "nobody", "x") != ErrBadCredentials {
		t.Fatal("unknown user")
	}
	if err := st.CreateAdmin(ctx, "second", "correct-horse-2"); err != ErrAdminExists {
		t.Fatalf("second admin: %v", err)
	}
}

func TestSessions(t *testing.T) {
	ctx := context.Background()
	st, err := Open(ctx, filepath.Join(t.TempDir(), "x.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	st.BootstrapAdmin(ctx, "admin", "correct-horse-1", false)

	a, _ := st.CreateSession(ctx, "admin", "1.1.1.1", "ua", time.Hour)
	b, _ := st.CreateSession(ctx, "admin", "2.2.2.2", "ua", time.Hour)
	sa, ok := st.LookupSession(ctx, a)
	if !ok {
		t.Fatal("session a invalid")
	}
	var stored string
	st.DB.QueryRow(`SELECT token_hash FROM sessions WHERE id = ?`, sa.ID).Scan(&stored)
	if stored == a {
		t.Fatal("raw token stored")
	}
	if err := st.ChangePassword(ctx, "admin", "correct-horse-1", "new-password-99", sa.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := st.LookupSession(ctx, b); ok {
		t.Fatal("other session survived password change")
	}
	if _, ok := st.LookupSession(ctx, a); !ok {
		t.Fatal("current session dropped")
	}
	exp, _ := st.CreateSession(ctx, "admin", "", "", -time.Minute)
	if _, ok := st.LookupSession(ctx, exp); ok {
		t.Fatal("expired session accepted")
	}
}

func TestSettingsNormalize(t *testing.T) {
	s := models.Settings{Theme: "evil", CardOpacity: 5, CardBlur: -3, AccentColor: "red", Sections: []string{"games", "x", "games", "music"}}
	s.Normalize()
	if s.Theme != "violet" || s.CardOpacity != 1 || s.CardBlur != 0 || s.AccentColor != "#8b5cf6" {
		t.Fatalf("%+v", s)
	}
	if len(s.Sections) != 2 || s.Sections[0] != "games" || s.Sections[1] != "music" {
		t.Fatalf("sections %v", s.Sections)
	}
}

func open(t *testing.T) *Store {
	t.Helper()
	st, err := Open(context.Background(), filepath.Join(t.TempDir(), "x.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestTOTP(t *testing.T) {
	ctx := context.Background()
	st := open(t)
	st.CreateAdmin(ctx, "admin", "correct-horse-1")

	secret, err := st.BeginTOTP(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	if on, _ := st.TOTPEnabled(ctx, "admin"); on {
		t.Fatal("enabled before confirmation")
	}
	if _, err := st.EnableTOTP(ctx, "admin", "000000"); err != ErrBadCode {
		t.Fatalf("wrong code: %v", err)
	}
	// Use the previous step so the login below can use the current one.
	prev, _ := totp.Code(secret, totp.Step(time.Now())-1)
	codes, err := st.EnableTOTP(ctx, "admin", prev)
	if err != nil || len(codes) != 10 {
		t.Fatalf("enable: %v %v", err, codes)
	}
	if st.CheckSecondFactor(ctx, "admin", prev) != ErrBadCode {
		t.Fatal("code used for enabling accepted again")
	}
	cur, _ := totp.Code(secret, totp.Step(time.Now()))
	if err := st.CheckSecondFactor(ctx, "admin", cur); err != nil {
		t.Fatal(err)
	}
	if st.CheckSecondFactor(ctx, "admin", cur) != ErrBadCode {
		t.Fatal("replayed code accepted")
	}
	if err := st.CheckSecondFactor(ctx, "admin", codes[0]); err != nil {
		t.Fatal("recovery code rejected")
	}
	if st.CheckSecondFactor(ctx, "admin", codes[0]) != ErrBadCode {
		t.Fatal("recovery code reused")
	}
	if n := st.RecoveryCodesLeft(ctx, "admin"); n != 9 {
		t.Fatalf("recovery codes left %d", n)
	}
	st.DisableTOTP(ctx, "admin")
	if on, _ := st.TOTPEnabled(ctx, "admin"); on {
		t.Fatal("still enabled")
	}
}

func TestSnapshots(t *testing.T) {
	ctx := context.Background()
	st := open(t)
	p, _, _ := st.Profile(ctx)
	orig := p.Name
	p.Name = "Changed"
	if err := st.SaveProfile(ctx, p, nil, nil); err != nil {
		t.Fatal(err)
	}
	snaps, _ := st.Snapshots(ctx)
	if len(snaps) != 1 || snaps[0].Name != orig {
		t.Fatalf("snapshots %+v", snaps)
	}
	if err := st.RestoreSnapshot(ctx, snaps[0].ID); err != nil {
		t.Fatal(err)
	}
	if p, _, _ = st.Profile(ctx); p.Name != orig {
		t.Fatalf("restore: %q", p.Name)
	}
	for i := 0; i < snapshotKeep+5; i++ {
		st.SaveProfile(ctx, p, nil, nil)
	}
	if snaps, _ = st.Snapshots(ctx); len(snaps) != snapshotKeep {
		t.Fatalf("kept %d snapshots", len(snaps))
	}
}

func TestExportImportRoundTrip(t *testing.T) {
	ctx := context.Background()
	st := open(t)
	key := "0123456789abcdef0123456789abcdef"
	p, _, _ := st.Profile(ctx)
	st.SaveProfile(ctx, p, &key, nil)
	st.SaveGame(ctx, &models.Game{Title: "Game A", BadgeType: "good"})
	pl := &models.Playlist{Title: "Mix", Type: "playlist", Tracks: []models.Track{{Title: "T1"}, {Title: "T2"}}}
	st.SavePlaylist(ctx, pl)

	e, err := st.ExportContent(ctx)
	if err != nil {
		t.Fatal(err)
	}
	e.Profile.Name = "Imported"
	e.Games = append(e.Games, models.Game{Title: "Game B", BadgeType: "masterpiece"})
	if err := st.ImportContent(ctx, e); err != nil {
		t.Fatal(err)
	}
	p, sec, _ := st.Profile(ctx)
	if p.Name != "Imported" || sec.SteamAPIKey != key {
		t.Fatalf("profile %q key %q", p.Name, sec.SteamAPIKey)
	}
	games, _ := st.Games(ctx)
	pls, _ := st.Playlists(ctx)
	if len(games) != 2 || len(pls) != 1 || len(pls[0].Tracks) != 2 {
		t.Fatalf("games %d playlists %+v", len(games), pls)
	}
}
