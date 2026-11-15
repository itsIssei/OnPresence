package api

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

type caseRow struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Items []struct {
		ID     int64  `json:"id"`
		CaseID int64  `json:"case_id"`
		Title  string `json:"title"`
		Status string `json:"status"`
		Size   string `json:"size"`
	} `json:"items"`
}

func (e *env) newCase(name string) int64 {
	e.t.Helper()
	res, body := e.do("POST", "/api/v1/admin/cases", map[string]any{"name": name})
	if res.StatusCode != 201 {
		e.t.Fatalf("create case: %d %s", res.StatusCode, body)
	}
	var c caseRow
	json.Unmarshal([]byte(body), &c)
	return c.ID
}

func (e *env) newCaseItem(caseID int64, title string) int64 {
	e.t.Helper()
	res, body := e.do("POST", "/api/v1/admin/caseitems", map[string]any{"case_id": caseID, "title": title})
	if res.StatusCode != 201 {
		e.t.Fatalf("create case item: %d %s", res.StatusCode, body)
	}
	var c caseRow
	json.Unmarshal([]byte(body), &c)
	return c.ID
}

// setSections saves the profile with the given sections (as a client that
// only knows the sections list) and returns the saved list.
func (e *env) setSections(sections []string) []string {
	e.t.Helper()
	_, body := e.do("GET", "/api/v1/admin/profile", nil)
	var p map[string]any
	json.Unmarshal([]byte(body), &p)
	st := p["settings"].(map[string]any)
	st["sections"] = sections
	delete(st, "vault_blocks")
	res, body := e.do("PUT", "/api/v1/admin/profile", p)
	if res.StatusCode != 200 {
		e.t.Fatalf("save profile: %d %s", res.StatusCode, body)
	}
	var out struct {
		Settings struct {
			Sections []string `json:"sections"`
		} `json:"settings"`
	}
	json.Unmarshal([]byte(body), &out)
	return out.Settings.Sections
}

func (e *env) vaultCases() []caseRow {
	e.t.Helper()
	_, body := e.do("GET", "/api/v1/vault", nil)
	var v struct {
		Cases []caseRow `json:"cases"`
	}
	if err := json.Unmarshal([]byte(body), &v); err != nil || v.Cases == nil {
		e.t.Fatalf("vault cases: %v %s", err, body)
	}
	return v.Cases
}

func TestCaseCRUD(t *testing.T) {
	e := newEnv(t)
	e.login()
	id := e.newCase("Books")
	res, body := e.do("POST", "/api/v1/admin/cases", map[string]any{"name": "Films", "layout": "wide", "aspect": "16:9", "icon": "star"})
	if res.StatusCode != 201 || !strings.Contains(body, `"layout":"wide"`) {
		t.Fatalf("create: %d %s", res.StatusCode, body)
	}
	// Defaults.
	_, list := e.do("GET", "/api/v1/admin/cases", nil)
	if !strings.Contains(list, `"layout":"poster"`) || !strings.Contains(list, `"aspect":"2:3"`) {
		t.Fatalf("defaults: %s", list)
	}
	it := e.newCaseItem(id, "Dune")
	res, body = e.do("PUT", "/api/v1/admin/caseitems/"+jsonNum(it), map[string]any{"case_id": id, "title": "Dune", "status": "completed", "size": "large", "rating": "9/10", "tags": "sf, classic", "note": "<b>plain</b>"})
	if res.StatusCode != 200 || !strings.Contains(body, `"status":"completed"`) || !strings.Contains(body, `"size":"large"`) {
		t.Fatalf("update item: %d %s", res.StatusCode, body)
	}
	res, body = e.do("PUT", "/api/v1/admin/cases/"+jsonNum(id), map[string]any{"name": "Books!", "layout": "list", "aspect": "1:1"})
	if res.StatusCode != 200 || !strings.Contains(body, `"name":"Books!"`) {
		t.Fatalf("update case: %d %s", res.StatusCode, body)
	}
	var cases []caseRow
	_, list = e.do("GET", "/api/v1/admin/cases", nil)
	json.Unmarshal([]byte(list), &cases)
	if len(cases) != 2 || len(cases[0].Items) != 1 || cases[0].Items[0].Title != "Dune" {
		t.Fatalf("list: %s", list)
	}
	if _, flat := e.do("GET", "/api/v1/admin/caseitems", nil); !strings.Contains(flat, `"case_id":`+jsonNum(id)) {
		t.Fatalf("flat items: %s", flat)
	}
	// Reorder both collections.
	if res, _ := e.do("PUT", "/api/v1/admin/cases/order", map[string]any{"ids": []int64{cases[1].ID, id}}); res.StatusCode != 200 {
		t.Fatalf("reorder cases: %d", res.StatusCode)
	}
	if res, _ := e.do("PUT", "/api/v1/admin/caseitems/order", map[string]any{"ids": []int64{it}}); res.StatusCode != 200 {
		t.Fatalf("reorder items: %d", res.StatusCode)
	}
	_, list = e.do("GET", "/api/v1/admin/cases", nil)
	json.Unmarshal([]byte(list), &cases)
	if cases[0].Name != "Films" {
		t.Fatalf("order not saved: %s", list)
	}
	if res, _ := e.do("DELETE", "/api/v1/admin/caseitems/"+jsonNum(it), nil); res.StatusCode != 200 {
		t.Fatalf("delete item: %d", res.StatusCode)
	}
	if res, _ := e.do("DELETE", "/api/v1/admin/caseitems/"+jsonNum(it), nil); res.StatusCode != 404 {
		t.Fatalf("delete missing item: %d", res.StatusCode)
	}
	if res, _ := e.do("PUT", "/api/v1/admin/cases/9999", map[string]any{"name": "x"}); res.StatusCode != 404 {
		t.Fatalf("update missing case: %d", res.StatusCode)
	}
}

func TestCaseValidation(t *testing.T) {
	e := newEnv(t)
	e.login()
	id := e.newCase("Books")
	bad := func(path string, body map[string]any, field string) {
		t.Helper()
		res, resp := e.do("POST", path, body)
		if res.StatusCode != 400 || !strings.Contains(resp, field) {
			t.Errorf("%s %v: %d %s", path, body, res.StatusCode, resp)
		}
	}
	bad("/api/v1/admin/cases", map[string]any{"name": ""}, "name")
	bad("/api/v1/admin/cases", map[string]any{"name": "x", "layout": "grid"}, "layout")
	bad("/api/v1/admin/cases", map[string]any{"name": "x", "aspect": "4:3"}, "aspect")
	bad("/api/v1/admin/cases", map[string]any{"name": "x", "icon": "javascript:alert(1)//x/"}, "icon")
	item := func(over map[string]any) map[string]any {
		m := map[string]any{"case_id": id, "title": "T"}
		for k, v := range over {
			m[k] = v
		}
		return m
	}
	bad("/api/v1/admin/caseitems", item(map[string]any{"size": "huge"}), "size")
	bad("/api/v1/admin/caseitems", item(map[string]any{"status": "foo"}), "status")
	bad("/api/v1/admin/caseitems", item(map[string]any{"image": "http://example.com/a.png"}), "image")
	bad("/api/v1/admin/caseitems", item(map[string]any{"link": "javascript:alert(1)"}), "link")
	bad("/api/v1/admin/caseitems", item(map[string]any{"link": "data:text/html,x"}), "link")
	bad("/api/v1/admin/caseitems", item(map[string]any{"title": ""}), "title")
	bad("/api/v1/admin/caseitems", item(map[string]any{"title": strings.Repeat("a", 161)}), "title")
	bad("/api/v1/admin/caseitems", item(map[string]any{"case_id": 9999}), "case_id")
	bad("/api/v1/admin/caseitems", item(map[string]any{"case_id": 0}), "case_id")
	// Valid values pass, and an empty status and size get defaults.
	res, body := e.do("POST", "/api/v1/admin/caseitems", item(map[string]any{"image": "/uploads/a.png", "link": "https://example.com/x"}))
	if res.StatusCode != 201 || !strings.Contains(body, `"status":"owned"`) || !strings.Contains(body, `"size":"medium"`) {
		t.Fatalf("valid item: %d %s", res.StatusCode, body)
	}
}

func TestCaseSectionsOrderAndVisibility(t *testing.T) {
	e := newEnv(t)
	e.login()
	books := e.newCase("Books")
	for _, t := range []string{"A", "B", "C"} {
		e.newCaseItem(books, t)
	}
	other := e.newCase("Hidden")
	e.newCaseItem(other, "X")
	e.do("POST", "/api/v1/admin/games", map[string]any{"title": "G"})

	// A case is hidden until it is listed in the sections.
	if c := e.vaultCases(); len(c) != 0 {
		t.Fatalf("case visible before listing: %+v", c)
	}
	books1 := caseSec(books)
	got := e.setSections([]string{books1, "games", "anime", "manga", "music", "referrals"})
	if len(got) != 6 || got[0] != books1 {
		t.Fatalf("sections: %v", got)
	}
	cs := e.vaultCases()
	if len(cs) != 1 || cs[0].ID != books || len(cs[0].Items) != 3 {
		t.Fatalf("vault cases: %+v", cs)
	}
	_, prof := e.do("GET", "/api/v1/profile", nil)
	if !strings.Contains(prof, `"sections":["`+books1+`","games"`) {
		t.Fatalf("public sections order: %s", prof)
	}
	// Hiding removes it from the vault.
	e.setSections([]string{"games"})
	if c := e.vaultCases(); len(c) != 0 {
		t.Fatalf("hidden case visible: %+v", c)
	}
	// Malformed entries, repeats, unknown fixed ids and missing cases are dropped.
	got = e.setSections([]string{"case:0", "case:-1", "case:01", "case:+" + jsonNum(books), "case:x", "case:", "nope", books1, books1, "case:9999", "games"})
	if len(got) != 2 || got[0] != books1 || got[1] != "games" {
		t.Fatalf("sections after cleanup: %v", got)
	}
	// A stale entry that is already stored (old snapshot) does not break the vault.
	e.do("DELETE", "/api/v1/admin/cases/"+jsonNum(books), nil)
	if c := e.vaultCases(); len(c) != 0 {
		t.Fatalf("deleted case in vault: %+v", c)
	}
}

func TestCaseDeleteCleansSectionsAndItems(t *testing.T) {
	e := newEnv(t)
	e.login()
	id := e.newCase("Books")
	e.newCaseItem(id, "A")
	e.newCaseItem(id, "B")
	other := e.newCase("Films")
	e.newCaseItem(other, "F")
	e.setSections([]string{"games", caseSec(id), caseSec(other)})
	if res, _ := e.do("DELETE", "/api/v1/admin/cases/"+jsonNum(id), nil); res.StatusCode != 200 {
		t.Fatalf("delete: %d", res.StatusCode)
	}
	_, prof := e.do("GET", "/api/v1/admin/profile", nil)
	if strings.Contains(prof, caseSec(id)+`"`) || !strings.Contains(prof, caseSec(other)) {
		t.Fatalf("sections after delete: %s", prof)
	}
	_, items := e.do("GET", "/api/v1/admin/caseitems", nil)
	var rows []struct {
		CaseID int64 `json:"case_id"`
	}
	json.Unmarshal([]byte(items), &rows)
	if len(rows) != 1 || rows[0].CaseID != other {
		t.Fatalf("items after delete: %s", items)
	}
	if res, _ := e.do("DELETE", "/api/v1/admin/cases/"+jsonNum(id), nil); res.StatusCode != 404 {
		t.Fatalf("delete twice: %d", res.StatusCode)
	}
	if res, _ := e.do("GET", "/api/v1/vault", nil); res.StatusCode != 200 {
		t.Fatalf("vault after delete: %d", res.StatusCode)
	}
}

func caseSec(id int64) string { return "case:" + jsonNum(id) }

func TestCaseExportV2RoundTrip(t *testing.T) {
	e := newEnv(t)
	e.login()
	id := e.newCase("Books")
	a := e.newCaseItem(id, "A")
	e.newCaseItem(id, "B")
	e.do("PUT", "/api/v1/admin/caseitems/"+jsonNum(a), map[string]any{"case_id": id, "title": "A", "status": "wishlist", "size": "small", "link": "https://example.com/a", "is_featured": true, "note": "n", "tags": "t1,t2", "rating": "8/10"})
	e.setSections([]string{"games", caseSec(id)})

	restore := func(data any) (int, string) {
		os.RemoveAll(e.cfg.BackupDir())
		res, body := e.do("POST", "/api/v1/admin/restore", data)
		return res.StatusCode, body
	}
	_, exp := e.do("GET", "/api/v1/admin/export", nil)
	var data map[string]any
	json.Unmarshal([]byte(exp), &data)
	if data["version"] != float64(2) || data["cases"] == nil {
		t.Fatalf("export: %s", exp)
	}
	_, before := e.do("GET", "/api/v1/admin/cases", nil)
	_, profBefore := e.do("GET", "/api/v1/admin/profile", nil)

	// Wipe, then restore: the same cases, items, ids and sections come back.
	e.do("DELETE", "/api/v1/admin/cases/"+jsonNum(id), nil)
	if code, body := restore(data); code != 200 {
		t.Fatalf("restore: %d %s", code, body)
	}
	_, after := e.do("GET", "/api/v1/admin/cases", nil)
	if after != before {
		t.Fatalf("cases differ:\n%s\n%s", before, after)
	}
	_, profAfter := e.do("GET", "/api/v1/admin/profile", nil)
	if !strings.Contains(profAfter, caseSec(id)) {
		t.Fatalf("section lost: %s (was %s)", profAfter, profBefore)
	}
	if cs := e.vaultCases(); len(cs) != 1 || len(cs[0].Items) != 2 {
		t.Fatalf("vault after restore: %+v", cs)
	}
	// Export again: identical content.
	_, exp2 := e.do("GET", "/api/v1/admin/export", nil)
	var data2 map[string]any
	json.Unmarshal([]byte(exp2), &data2)
	a1, _ := json.Marshal(data["cases"])
	a2, _ := json.Marshal(data2["cases"])
	if string(a1) != string(a2) {
		t.Fatalf("second export differs:\n%s\n%s", a1, a2)
	}

	// A section entry whose case is not in the file is dropped.
	data["cases"] = []any{}
	if code, body := restore(data); code != 200 {
		t.Fatalf("restore empty cases: %d %s", code, body)
	}
	_, list := e.do("GET", "/api/v1/admin/cases", nil)
	_, prof := e.do("GET", "/api/v1/admin/profile", nil)
	if strings.TrimSpace(list) != "[]" || strings.Contains(prof, "case:") {
		t.Fatalf("after empty restore: %s %s", list, prof)
	}

	// Repeated and negative ids do not break the restore.
	data["cases"] = []any{
		map[string]any{"id": 5, "name": "One", "items": []any{map[string]any{"id": 7, "title": "x"}, map[string]any{"id": 7, "title": "y"}}},
		map[string]any{"id": 5, "name": "Two", "items": []any{map[string]any{"id": -1, "title": "z"}}},
	}
	if code, body := restore(data); code != 200 {
		t.Fatalf("restore with repeated ids: %d %s", code, body)
	}
	_, list = e.do("GET", "/api/v1/admin/cases", nil)
	var rows []caseRow
	json.Unmarshal([]byte(list), &rows)
	if len(rows) != 2 || len(rows[0].Items)+len(rows[1].Items) != 3 {
		t.Fatalf("after dedupe: %s", list)
	}

	// Bad entries are rejected before anything is replaced.
	for name, c := range map[string]map[string]any{
		"layout":   {"name": "x", "layout": "grid"},
		"name":     {"name": ""},
		"item url": {"name": "x", "items": []any{map[string]any{"title": "t", "link": "javascript:alert(1)"}}},
		"status":   {"name": "x", "items": []any{map[string]any{"title": "t", "status": "foo"}}},
	} {
		data["cases"] = []any{c}
		if code, body := restore(data); code != 400 || !strings.Contains(body, "cases[0]") {
			t.Errorf("%s restored: %d %s", name, code, body)
		}
	}
	// A version from the future is refused.
	data["version"] = 3
	if code, _ := restore(data); code != 400 {
		t.Fatalf("version 3: %d", code)
	}
}

// A v1 file has no "cases": the current cases stay in the database.
func TestCaseV1ExportRestoreKeepsCases(t *testing.T) {
	e := newEnv(t)
	e.login()
	id := e.newCase("Books")
	e.newCaseItem(id, "A")
	e.setSections([]string{"games", caseSec(id)})
	// A fixed v1 body.
	v1 := map[string]any{
		"app":       "onpresence",
		"version":   1,
		"profile":   map[string]any{"name": "Old Me", "settings": map[string]any{"sections": []string{"games", "music", "case:9999"}}},
		"links":     []any{},
		"badges":    []any{},
		"games":     []any{map[string]any{"id": 1, "title": "Old game"}},
		"media":     []any{},
		"playlists": []any{},
		"referrals": []any{},
	}
	os.RemoveAll(e.cfg.BackupDir())
	if res, body := e.do("POST", "/api/v1/admin/restore", v1); res.StatusCode != 200 {
		t.Fatalf("v1 restore: %d %s", res.StatusCode, body)
	}
	_, list := e.do("GET", "/api/v1/admin/cases", nil)
	var rows []caseRow
	json.Unmarshal([]byte(list), &rows)
	if len(rows) != 1 || rows[0].ID != id || len(rows[0].Items) != 1 {
		t.Fatalf("cases lost by a v1 restore: %s", list)
	}
	// The file's sections do not list the case, so it is hidden; a missing case is dropped.
	_, prof := e.do("GET", "/api/v1/admin/profile", nil)
	if strings.Contains(prof, "case:") || !strings.Contains(prof, `"name":"Old Me"`) {
		t.Fatalf("profile after v1 restore: %s", prof)
	}
	if c := e.vaultCases(); len(c) != 0 {
		t.Fatalf("case visible: %+v", c)
	}
}

func TestExistingCaseKeptWhenV1ListsIt(t *testing.T) {
	e := newEnv(t)
	e.login()
	id := e.newCase("Books")
	v1 := map[string]any{
		"app": "onpresence", "version": 1,
		"profile": map[string]any{"name": "Me", "settings": map[string]any{"sections": []string{caseSec(id)}}},
	}
	os.RemoveAll(e.cfg.BackupDir())
	if res, body := e.do("POST", "/api/v1/admin/restore", v1); res.StatusCode != 200 {
		t.Fatalf("restore: %d %s", res.StatusCode, body)
	}
	if c := e.vaultCases(); len(c) != 1 {
		t.Fatalf("case should be visible: %+v", c)
	}
}

// profilePut saves the profile with the given settings changes and returns
// the saved settings.
func (e *env) putSettings(change func(st map[string]any)) (int, map[string]any) {
	e.t.Helper()
	_, body := e.do("GET", "/api/v1/admin/profile", nil)
	var p map[string]any
	json.Unmarshal([]byte(body), &p)
	change(p["settings"].(map[string]any))
	res, body := e.do("PUT", "/api/v1/admin/profile", p)
	var out struct {
		Settings map[string]any `json:"settings"`
	}
	json.Unmarshal([]byte(body), &out)
	return res.StatusCode, out.Settings
}

func TestVaultBlocksSaveAndSync(t *testing.T) {
	e := newEnv(t)
	e.login()
	books := e.newCase("Books")
	e.newCaseItem(books, "A")
	b1 := caseSec(books)

	blocks := []any{
		map[string]any{"type": "recent", "count": 4},
		map[string]any{"type": "text", "title": "Hello", "body": "<b>x</b>"},
		map[string]any{"type": "section", "section": "games", "layout": "list", "density": "compact"},
		map[string]any{"type": "section", "section": b1},
		map[string]any{"type": "section", "section": "case:9999"}, // no such case
		map[string]any{"type": "section", "section": "games"},     // repeat
		map[string]any{"type": "hero"},
	}
	code, st := e.putSettings(func(st map[string]any) { st["vault_blocks"] = blocks })
	if code != 200 {
		t.Fatalf("save: %d", code)
	}
	want := `[{"type":"recent","count":4},{"type":"text","title":"Hello","body":"\u003cb\u003ex\u003c/b\u003e"},` +
		`{"type":"section","section":"games","layout":"list","density":"compact"},` +
		`{"type":"section","section":"` + b1 + `","density":"normal"}]`
	var wantBlocks any
	json.Unmarshal([]byte(want), &wantBlocks)
	if !reflect.DeepEqual(st["vault_blocks"], wantBlocks) {
		t.Fatalf("blocks: %v\nwant %v", st["vault_blocks"], wantBlocks)
	}
	secs, _ := json.Marshal(st["sections"])
	if string(secs) != `["games","`+b1+`"]` {
		t.Fatalf("sections: %s", secs)
	}
	// The public profile and vault follow the blocks.
	_, prof := e.do("GET", "/api/v1/profile", nil)
	if !strings.Contains(prof, `"sections":["games","`+b1+`"]`) || !strings.Contains(prof, `"vault_blocks":[{"type":"recent"`) {
		t.Fatalf("public profile: %s", prof)
	}
	if cs := e.vaultCases(); len(cs) != 1 || cs[0].ID != books {
		t.Fatalf("vault cases: %+v", cs)
	}

	// Deleting the case removes its block.
	e.do("DELETE", "/api/v1/admin/cases/"+jsonNum(books), nil)
	_, body := e.do("GET", "/api/v1/admin/profile", nil)
	if strings.Contains(body, b1) || !strings.Contains(body, `"sections":["games"]`) {
		t.Fatalf("after delete: %s", body)
	}

	// An empty list is an empty page, not a request for the default.
	_, st = e.putSettings(func(st map[string]any) { st["vault_blocks"] = []any{} })
	if b, _ := json.Marshal(st["vault_blocks"]); string(b) != "[]" {
		t.Fatalf("empty blocks: %s", b)
	}
	if b, _ := json.Marshal(st["sections"]); string(b) != "[]" {
		t.Fatalf("empty sections: %s", b)
	}

	// A payload without blocks (an old client) derives them from sections.
	_, st = e.putSettings(func(st map[string]any) {
		delete(st, "vault_blocks")
		st["sections"] = []any{"music", "games"}
	})
	var derived any
	json.Unmarshal([]byte(`[{"type":"section","section":"music","layout":"grid","density":"normal"},{"type":"section","section":"games","layout":"grid","density":"normal"}]`), &derived)
	if !reflect.DeepEqual(st["vault_blocks"], derived) {
		t.Fatalf("derived: %v", st["vault_blocks"])
	}
}

func TestVaultBlocksRestore(t *testing.T) {
	e := newEnv(t)
	e.login()
	books := e.newCase("Books")
	b1 := caseSec(books)
	e.putSettings(func(st map[string]any) {
		st["vault_blocks"] = []any{map[string]any{"type": "stats"}, map[string]any{"type": "section", "section": b1}, map[string]any{"type": "section", "section": "music"}}
	})
	_, exp := e.do("GET", "/api/v1/admin/export", nil)
	var data map[string]any
	json.Unmarshal([]byte(exp), &data)
	if data["version"] != float64(2) {
		t.Fatalf("export version: %v", data["version"])
	}
	// Blocks survive an export and restore.
	res, body := e.do("POST", "/api/v1/admin/restore", data)
	if res.StatusCode != 200 {
		t.Fatalf("restore: %d %s", res.StatusCode, body)
	}
	_, prof := e.do("GET", "/api/v1/admin/profile", nil)
	if !strings.Contains(prof, `"vault_blocks":[{"type":"stats"},{"type":"section","section":"`+b1+`"`) {
		t.Fatalf("blocks after restore: %s", prof)
	}
	// A file without blocks gets the default derived from its sections.
	st := data["profile"].(map[string]any)["settings"].(map[string]any)
	delete(st, "vault_blocks")
	st["sections"] = []any{"anime", "games"}
	res, body = e.do("POST", "/api/v1/admin/restore", data)
	if res.StatusCode != 200 {
		t.Fatalf("restore: %d %s", res.StatusCode, body)
	}
	_, prof = e.do("GET", "/api/v1/admin/profile", nil)
	if !strings.Contains(prof, `"sections":["anime","games"],"vault_blocks":[{"type":"section","section":"anime","layout":"grid","density":"normal"},{"type":"section","section":"games","layout":"grid","density":"normal"}]`) {
		t.Fatalf("derived after restore: %s", prof)
	}
	// A block for a case that is not in the file is dropped.
	st["vault_blocks"] = []any{map[string]any{"type": "section", "section": "case:9999"}, map[string]any{"type": "text", "body": "x"}}
	res, _ = e.do("POST", "/api/v1/admin/restore", data)
	_, prof = e.do("GET", "/api/v1/admin/profile", nil)
	if res.StatusCode != 200 || strings.Contains(prof, "case:9999") || !strings.Contains(prof, `"vault_blocks":[{"type":"text","body":"x"}]`) {
		t.Fatalf("stale case block: %d %s", res.StatusCode, prof)
	}
}
