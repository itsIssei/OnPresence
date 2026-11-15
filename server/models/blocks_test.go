package models

import (
	"reflect"
	"strings"
	"testing"
)

func normalized(s Settings) Settings {
	s.Normalize()
	return s
}

func TestBlocksDerivedFromSections(t *testing.T) {
	// No blocks: one default section block per section, nothing else.
	s := DefaultSettings()
	s.Sections = []string{"music", "case:3", "games", "bogus", "games"}
	s = normalized(s)
	want := []VaultBlock{
		{Type: "section", Section: "music", Layout: "grid", Density: "normal"},
		{Type: "section", Section: "case:3", Layout: "", Density: "normal"},
		{Type: "section", Section: "games", Layout: "grid", Density: "normal"},
	}
	if !reflect.DeepEqual(s.VaultBlocks, want) {
		t.Fatalf("derived blocks: %+v", s.VaultBlocks)
	}
	if !reflect.DeepEqual(s.Sections, []string{"music", "case:3", "games"}) {
		t.Fatalf("sections: %v", s.Sections)
	}
	for _, b := range s.VaultBlocks {
		if b.Type == "stats" {
			t.Fatal("stats must not be derived")
		}
	}
	// Default settings: all five fixed sections, in order.
	d := normalized(DefaultSettings())
	if !reflect.DeepEqual(d.Sections, SectionIDs) || len(d.VaultBlocks) != len(SectionIDs) {
		t.Fatalf("default: %v %+v", d.Sections, d.VaultBlocks)
	}
	// No sections and no blocks (old settings that hid everything): empty page.
	e := DefaultSettings()
	e.Sections = []string{}
	e = normalized(e)
	if e.VaultBlocks == nil || len(e.VaultBlocks) != 0 || len(e.Sections) != 0 {
		t.Fatalf("empty: %+v %v", e.VaultBlocks, e.Sections)
	}
}

func TestBlocksWinOverSections(t *testing.T) {
	s := DefaultSettings()
	s.Sections = []string{"games", "anime"}
	s.VaultBlocks = []VaultBlock{
		{Type: "recent"},
		{Type: "section", Section: "music"},
		{Type: "text", Title: "Hi"},
		{Type: "section", Section: "games"},
	}
	s = normalized(s)
	if !reflect.DeepEqual(s.Sections, []string{"music", "games"}) {
		t.Fatalf("sections must follow the section blocks: %v", s.Sections)
	}
	// Explicit empty list stays empty, whatever Sections says.
	s.VaultBlocks = []VaultBlock{}
	s = normalized(s)
	if len(s.VaultBlocks) != 0 || len(s.Sections) != 0 {
		t.Fatalf("empty blocks: %+v %v", s.VaultBlocks, s.Sections)
	}
}

func TestBlocksNormalizeRules(t *testing.T) {
	long := strings.Repeat("ö", MaxBlockBody+50)
	s := DefaultSettings()
	s.VaultBlocks = []VaultBlock{
		{Type: "hero"},                       // unknown type
		{Type: ""},                           // no type
		{Type: "section", Section: "nope"},   // unknown section
		{Type: "section", Section: "case:x"}, // bad case id
		{Type: "section", Section: "case:0"},
		{Type: "section", Section: "games", Layout: "wide", Density: "huge", Title: "  My games  "},
		{Type: "section", Section: "games", Layout: "list"}, // repeat
		{Type: "section", Section: "referrals", Layout: "list", Density: "compact"},
		{Type: "section", Section: "case:7", Layout: "wide"},
		{Type: "section", Section: "case:8", Layout: "poster"},
		{Type: "text", Title: strings.Repeat("t", 500), Body: long, Section: "games", Layout: "list", Count: 5},
		{Type: "stats", Body: "x", Count: 9},
		{Type: "featured", Title: "Best"},
		{Type: "recent"},
		{Type: "recent", Count: 100},
		{Type: "recent", Count: -3}, // not positive: default
	}
	s = normalized(s)
	want := []VaultBlock{
		{Type: "section", Section: "games", Layout: "grid", Density: "normal", Title: "My games"},
		{Type: "section", Section: "referrals", Layout: "grid", Density: "compact"},
		{Type: "section", Section: "case:7", Layout: "wide", Density: "normal"},
		{Type: "section", Section: "case:8", Layout: "", Density: "normal"},
	}
	if !reflect.DeepEqual(s.VaultBlocks[:4], want) {
		t.Fatalf("section blocks: %+v", s.VaultBlocks[:4])
	}
	rest := s.VaultBlocks[4:]
	if len(rest) != 6 {
		t.Fatalf("blocks: %+v", s.VaultBlocks)
	}
	txt := rest[0]
	if txt.Type != "text" || len([]rune(txt.Title)) != MaxBlockTitle || len([]rune(txt.Body)) != MaxBlockBody || txt.Section != "" || txt.Layout != "" || txt.Count != 0 {
		t.Fatalf("text block: type=%s title=%d body=%d %+v", txt.Type, len([]rune(txt.Title)), len([]rune(txt.Body)), txt)
	}
	if rest[1] != (VaultBlock{Type: "stats"}) {
		t.Fatalf("stats block: %+v", rest[1])
	}
	if rest[2] != (VaultBlock{Type: "featured", Title: "Best"}) {
		t.Fatalf("featured block: %+v", rest[2])
	}
	if rest[3].Count != DefaultRecentNum || rest[4].Count != MaxRecentItems || rest[5].Count != DefaultRecentNum {
		t.Fatalf("recent counts: %d %d %d", rest[3].Count, rest[4].Count, rest[5].Count)
	}
}

func TestBlocksLimit(t *testing.T) {
	s := DefaultSettings()
	for i := 0; i < 50; i++ {
		s.VaultBlocks = append(s.VaultBlocks, VaultBlock{Type: "text", Body: "x"})
	}
	s = normalized(s)
	if len(s.VaultBlocks) != MaxVaultBlocks {
		t.Fatalf("blocks kept: %d", len(s.VaultBlocks))
	}
}

func TestBlocksPlainText(t *testing.T) {
	// The body is stored as is: no markup handling on the server.
	s := DefaultSettings()
	s.VaultBlocks = []VaultBlock{{Type: "text", Body: "<b>x</b>\nline two"}}
	s = normalized(s)
	if s.VaultBlocks[0].Body != "<b>x</b>\nline two" {
		t.Fatalf("body: %q", s.VaultBlocks[0].Body)
	}
}

func TestPruneCases(t *testing.T) {
	s := DefaultSettings()
	s.VaultBlocks = []VaultBlock{
		{Type: "section", Section: "case:1"},
		{Type: "text", Body: "keep"},
		{Type: "section", Section: "case:2"},
		{Type: "section", Section: "games"},
	}
	s.Normalize()
	s.PruneCases(func(id int64) bool { return id == 2 })
	if len(s.VaultBlocks) != 3 || s.VaultBlocks[1].Section != "case:2" {
		t.Fatalf("blocks: %+v", s.VaultBlocks)
	}
	if !reflect.DeepEqual(s.Sections, []string{"case:2", "games"}) {
		t.Fatalf("sections: %v", s.Sections)
	}
}

func TestTierLayoutOnlyForGames(t *testing.T) {
	s := DefaultSettings()
	s.VaultBlocks = []VaultBlock{
		{Type: "section", Section: "games", Layout: "tier", Density: "compact"},
		{Type: "section", Section: "anime", Layout: "tier"},
		{Type: "section", Section: "manga", Layout: "list"},
		{Type: "section", Section: "music", Layout: "tier"},
		{Type: "section", Section: "referrals", Layout: "tier"},
		{Type: "section", Section: "case:4", Layout: "tier"},
	}
	s = normalized(s)
	want := []VaultBlock{
		{Type: "section", Section: "games", Layout: "tier", Density: "compact"},
		{Type: "section", Section: "anime", Layout: "grid", Density: "normal"},
		{Type: "section", Section: "manga", Layout: "list", Density: "normal"},
		{Type: "section", Section: "music", Layout: "grid", Density: "normal"},
		{Type: "section", Section: "referrals", Layout: "grid", Density: "normal"},
		{Type: "section", Section: "case:4", Layout: "", Density: "normal"},
	}
	if !reflect.DeepEqual(s.VaultBlocks, want) {
		t.Fatalf("tier layout: %+v", s.VaultBlocks)
	}
}
