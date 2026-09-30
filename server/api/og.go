package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io/fs"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	_ "golang.org/x/image/webp"

	"onpresence/server/models"
)

// Generated link preview image (og:image), 1200x630, rendered from the
// profile and cached in memory until the profile changes.

const ogW, ogH = 1200, 630

type ogCache struct {
	mu  sync.Mutex
	key string
	png []byte
}

var (
	ogFontsOnce       sync.Once
	ogBold, ogRegular *opentype.Font

	// Page background per theme (keep in sync with web/src/lib/theme.ts).
	themeBackgrounds = map[string]string{
		"crimson": "#0b0709", "violet": "#09070e", "emerald": "#060a09",
		"ice": "#060a0e", "gold": "#0b0906", "mono": "#08080a",
	}
)

func ogFonts() {
	ogFontsOnce.Do(func() {
		ogBold, _ = opentype.Parse(gobold.TTF)
		ogRegular, _ = opentype.Parse(goregular.TTF)
	})
}

// ogVersion changes whenever the rendered image would change.
func ogVersion(p models.Profile) string {
	sum := sha256.Sum256([]byte(p.UpdatedAt + "|" + p.Name + "|" + p.AvatarURL))
	return hex.EncodeToString(sum[:6])
}

func (s *Server) serveOG(w http.ResponseWriter, r *http.Request) {
	p, _, err := s.store.Profile(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	host := hostOf(s.baseURL(r))
	key := ogVersion(p) + host
	s.og.mu.Lock()
	defer s.og.mu.Unlock()
	if s.og.key != key {
		var buf bytes.Buffer
		if err := png.Encode(&buf, s.renderOG(p, host)); err != nil {
			serverError(w, r, err)
			return
		}
		s.og.key, s.og.png = key, buf.Bytes()
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(s.og.png)
}

func (s *Server) renderOG(p models.Profile, host string) *image.RGBA {
	ogFonts()
	accent := parseHex(p.Settings.AccentColor, color.RGBA{139, 92, 246, 255})
	bg := parseHex(themeBackgrounds[p.Settings.Theme], color.RGBA{9, 7, 14, 255})

	img := image.NewRGBA(image.Rect(0, 0, ogW, ogH))
	// Background: theme color with an accent glow behind the avatar.
	for y := 0; y < ogH; y++ {
		for x := 0; x < ogW; x++ {
			dx, dy := float64(x-260)/900, float64(y-200)/700
			t := math.Max(0, 1-math.Sqrt(dx*dx+dy*dy)) * 0.55
			img.SetRGBA(x, y, mix(bg, accent, t))
		}
	}
	// Optional card banner, dimmed so the text stays readable.
	if banner := s.loadLocalImage(p.CardBgURL); banner != nil {
		layer := image.NewRGBA(img.Bounds())
		coverScale(layer, banner)
		draw.Draw(img, img.Bounds(), layer, image.Point{}, draw.Over)
		draw.DrawMask(img, img.Bounds(), &image.Uniform{bg}, image.Point{}, &image.Uniform{color.Alpha{200}}, image.Point{}, draw.Over)
	}

	// Avatar circle with an accent ring. Without a raster avatar, the first
	// letter of the name is drawn instead.
	const cx, cy, rad = 250, ogH / 2, 150
	fillCircle(img, cx, cy, rad+10, accent)
	if av := s.loadLocalImage(p.AvatarURL); av != nil {
		square := image.NewRGBA(image.Rect(0, 0, rad*2, rad*2))
		coverScale(square, av)
		draw.DrawMask(img, image.Rect(cx-rad, cy-rad, cx+rad, cy+rad), square, image.Point{}, circleMask{rad}, image.Point{}, draw.Over)
	} else {
		fillCircle(img, cx, cy, rad, mix(bg, accent, 0.35))
		initial, _ := utf8.DecodeRuneInString(strings.ToUpper(p.Name))
		drawCentered(img, ogFace(ogBold, 150), string(initial), cx, cy+52, color.White)
	}

	// Text column.
	const tx, maxW = 470, ogW - 470 - 70
	name, sub, body := ogFace(ogBold, 76), ogFace(ogRegular, 34), ogFace(ogRegular, 30)
	y := 250
	drawText(img, name, fitText(name, p.Name, maxW), tx, y, color.White)
	y += 62
	if line := strings.Join(nonEmpty(p.Handle, p.Title), "  ·  "); line != "" {
		drawText(img, sub, fitText(sub, line, maxW), tx, y, mix(color.RGBA{255, 255, 255, 255}, accent, 0.45))
		y += 60
	}
	for _, l := range wrap(body, firstLine(p.Bio), maxW, 2) {
		drawText(img, body, l, tx, y, color.RGBA{220, 220, 228, 255})
		y += 42
	}
	if host != "" {
		drawText(img, ogFace(ogRegular, 26), host, tx, ogH-60, color.RGBA{170, 170, 185, 255})
	}
	return img
}

// loadLocalImage decodes an uploaded file or a bundled /img raster image.
// Remote URLs are never fetched.
func (s *Server) loadLocalImage(u string) image.Image {
	var data []byte
	var err error
	switch {
	case strings.HasPrefix(u, "/uploads/"):
		data, err = os.ReadFile(filepath.Join(s.cfg.UploadsDir(), filepath.Base(u)))
	case strings.HasPrefix(u, "/img/") && !strings.Contains(u, ".."):
		data, err = fs.ReadFile(s.web, strings.TrimPrefix(u, "/"))
	default:
		return nil
	}
	if err != nil {
		return nil
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil
	}
	return img
}

func ogFace(f *opentype.Font, size float64) font.Face {
	face, err := opentype.NewFace(f, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		panic(err)
	}
	return face
}

func drawText(dst draw.Image, face font.Face, s string, x, y int, c color.Color) {
	d := font.Drawer{Dst: dst, Src: image.NewUniform(c), Face: face, Dot: fixed.P(x, y)}
	d.DrawString(s)
}

func drawCentered(dst draw.Image, face font.Face, s string, cx, baseline int, c color.Color) {
	drawText(dst, face, s, cx-font.MeasureString(face, s).Round()/2, baseline, c)
}

// fitText shortens s with an ellipsis until it fits in maxW pixels.
func fitText(face font.Face, s string, maxW int) string {
	if font.MeasureString(face, s).Round() <= maxW {
		return s
	}
	r := []rune(s)
	for len(r) > 0 && font.MeasureString(face, string(r)+"…").Round() > maxW {
		r = r[:len(r)-1]
	}
	return strings.TrimSpace(string(r)) + "…"
}

// wrap splits s into at most n lines of maxW pixels; the last line gets an
// ellipsis when text was cut.
func wrap(face font.Face, s string, maxW, n int) []string {
	words := strings.Fields(s)
	var out []string
	cur := ""
	for i, w := range words {
		next := strings.TrimSpace(cur + " " + w)
		if font.MeasureString(face, next).Round() <= maxW || cur == "" {
			cur = next
			continue
		}
		out = append(out, cur)
		cur = w
		if len(out) == n {
			out[n-1] = fitText(face, out[n-1]+" "+strings.Join(words[i:], " "), maxW)
			return out
		}
	}
	if cur != "" {
		out = append(out, fitText(face, cur, maxW))
	}
	return out
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return s
}

func nonEmpty(xs ...string) []string {
	var out []string
	for _, x := range xs {
		if x = strings.TrimSpace(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

// coverScale scales src to fill dst (like CSS background-size: cover).
func coverScale(dst *image.RGBA, src image.Image) {
	sb, db := src.Bounds(), dst.Bounds()
	scale := math.Max(float64(db.Dx())/float64(sb.Dx()), float64(db.Dy())/float64(sb.Dy()))
	w, h := int(float64(sb.Dx())*scale), int(float64(sb.Dy())*scale)
	ox, oy := (w-db.Dx())/2, (h-db.Dy())/2
	xdraw.CatmullRom.Scale(dst, image.Rect(-ox, -oy, w-ox, h-oy), src, sb, xdraw.Src, nil)
}

// circleMask is an anti-aliased disc of radius r at (r, r).
type circleMask struct{ r int }

func (c circleMask) ColorModel() color.Model { return color.AlphaModel }
func (c circleMask) Bounds() image.Rectangle { return image.Rect(0, 0, c.r*2, c.r*2) }
func (c circleMask) At(x, y int) color.Color {
	dx, dy := float64(x-c.r)+0.5, float64(y-c.r)+0.5
	d := math.Sqrt(dx*dx+dy*dy) - float64(c.r)
	switch {
	case d <= -1:
		return color.Alpha{255}
	case d >= 0:
		return color.Alpha{0}
	default:
		return color.Alpha{uint8(-d * 255)}
	}
}

func fillCircle(img *image.RGBA, cx, cy, r int, c color.RGBA) {
	draw.DrawMask(img, image.Rect(cx-r, cy-r, cx+r, cy+r), &image.Uniform{c}, image.Point{}, circleMask{r}, image.Point{}, draw.Over)
}

func mix(a, b color.RGBA, t float64) color.RGBA {
	l := func(x, y uint8) uint8 { return uint8(float64(x)*(1-t) + float64(y)*t) }
	return color.RGBA{l(a.R, b.R), l(a.G, b.G), l(a.B, b.B), 255}
}

func parseHex(s string, def color.RGBA) color.RGBA {
	if !models.IsHexColor(s) {
		return def
	}
	n, err := strconv.ParseUint(s[1:], 16, 32)
	if err != nil {
		return def
	}
	return color.RGBA{uint8(n >> 16), uint8(n >> 8), uint8(n), 255}
}
