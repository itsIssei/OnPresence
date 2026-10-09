package services

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// FetchSiteIcon downloads the best icon of the site at pageURL and returns
// it as PNG, JPEG, GIF or WebP bytes with the matching file extension. It
// looks at the page's <link rel="icon"> / apple-touch-icon tags first, then
// at the usual /apple-touch-icon.png and /favicon.ico paths. Only public
// https hosts are contacted (apiClient refuses private addresses).
func FetchSiteIcon(pageURL string) ([]byte, string, error) {
	base, err := url.Parse(strings.TrimSpace(pageURL))
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil {
		return nil, "", errors.New("use an https:// link")
	}

	var candidates []string
	if html, err := fetchLimited(base.String(), 512<<10); err == nil {
		candidates = iconLinks(html, base)
	}
	root := base.Scheme + "://" + base.Host
	candidates = append(candidates, root+"/apple-touch-icon.png", root+"/favicon.png", root+"/favicon.ico")

	seen := map[string]bool{}
	for _, c := range candidates {
		if seen[c] {
			continue
		}
		seen[c] = true
		data, err := fetchLimited(c, 2<<20)
		if err != nil {
			continue
		}
		if img, ext := usableIcon(data); img != nil {
			return img, ext, nil
		}
	}
	return nil, "", errors.New("no usable icon found on that site")
}

func fetchLimited(u string, limit int64) ([]byte, error) {
	parsed, err := url.Parse(u)
	if err != nil || parsed.Scheme != "https" {
		return nil, errors.New("not https")
	}
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; profile-card icon fetcher)")
	req.Header.Set("Accept", "text/html,image/*;q=0.9,*/*;q=0.5")
	res, err := apiClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, errors.New(res.Status)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		data = data[:limit]
	}
	return data, nil
}

var (
	linkTag = regexp.MustCompile(`(?is)<link\b[^>]*>`)
	attrRe  = regexp.MustCompile(`(?is)\b(rel|href|sizes|type)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`)
)

// iconLinks returns icon URLs from the page, best first (apple-touch-icon and
// large PNG icons before small or unknown ones).
func iconLinks(html []byte, base *url.URL) []string {
	type cand struct {
		url   string
		score int
	}
	var list []cand
	for _, tag := range linkTag.FindAll(html, 40) {
		attrs := map[string]string{}
		for _, m := range attrRe.FindAllSubmatch(tag, -1) {
			v := string(m[2])
			if v == "" {
				v = string(m[3])
			}
			if v == "" {
				v = string(m[4])
			}
			attrs[strings.ToLower(string(m[1]))] = strings.TrimSpace(v)
		}
		rel := strings.ToLower(attrs["rel"])
		if !strings.Contains(rel, "icon") || attrs["href"] == "" || strings.Contains(rel, "mask-icon") {
			continue
		}
		ref, err := url.Parse(attrs["href"])
		if err != nil {
			continue
		}
		abs := base.ResolveReference(ref)
		if abs.Scheme != "https" {
			continue
		}
		score := 0
		if strings.Contains(rel, "apple-touch-icon") {
			score += 200
		}
		if strings.Contains(attrs["type"], "png") || strings.HasSuffix(strings.ToLower(abs.Path), ".png") {
			score += 50
		}
		if w, _, ok := strings.Cut(strings.ToLower(attrs["sizes"]), "x"); ok {
			if n, err := strconv.Atoi(w); err == nil {
				score += min(n, 192)
			}
		}
		list = append(list, cand{abs.String(), score})
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].score > list[j].score })
	out := make([]string, len(list))
	for i, c := range list {
		out[i] = c.url
	}
	return out
}

var pngMagic = []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}

// usableIcon accepts PNG/JPEG/GIF/WebP as-is and pulls the largest PNG out of
// an .ico file. Old .ico files that only hold BMP data are skipped.
func usableIcon(data []byte) ([]byte, string) {
	switch http.DetectContentType(data) {
	case "image/png":
		return data, ".png"
	case "image/jpeg":
		return data, ".jpg"
	case "image/gif":
		return data, ".gif"
	case "image/webp":
		return data, ".webp"
	}
	if len(data) < 6 || data[0] != 0 || data[1] != 0 || data[2] != 1 || data[3] != 0 {
		return nil, ""
	}
	count := int(binary.LittleEndian.Uint16(data[4:6]))
	var best []byte
	for i := 0; i < count && 6+16*(i+1) <= len(data); i++ {
		e := data[6+16*i:]
		size := int(binary.LittleEndian.Uint32(e[8:12]))
		off := int(binary.LittleEndian.Uint32(e[12:16]))
		if off < 0 || size <= 0 || off+size > len(data) {
			continue
		}
		img := data[off : off+size]
		if bytes.HasPrefix(img, pngMagic) && len(img) > len(best) {
			best = img
		}
	}
	if best == nil {
		return nil, ""
	}
	return best, ".png"
}
