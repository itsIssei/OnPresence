// Command brandgen renders the PNG app icons and favicon.ico from the same
// shapes as web/public/img/brand/icon.svg. Run it after changing the colors:
//
//	go run ./tools/brandgen -out web/public
package main

import (
	"bytes"
	"encoding/binary"
	"flag"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"os"
	"path/filepath"
	"strconv"
)

func main() {
	out := flag.String("out", "web/public", "web/public directory")
	bg := flag.String("bg", "#110b1f", "background color")
	from := flag.String("from", "#c4b5fd", "ring gradient start")
	to := flag.String("to", "#7c3aed", "ring gradient end")
	dot := flag.String("dot", "#22c55e", "status dot color")
	flag.Parse()

	ic := icon{bg: hex(*bg), from: hex(*from), to: hex(*to), dot: hex(*dot)}
	for _, size := range []int{180, 192, 512} {
		writePNG(filepath.Join(*out, "img", "brand", "icon-"+strconv.Itoa(size)+".png"), ic.render(size))
	}
	if err := os.WriteFile(filepath.Join(*out, "favicon.ico"), ico(ic.render(16), ic.render(32), ic.render(48)), 0o644); err != nil {
		log.Fatal(err)
	}
}

type icon struct{ bg, from, to, dot color.NRGBA }

// shade returns the color at icon coordinate (x, y) in a 64x64 space.
func (ic icon) shade(x, y float64) (color.NRGBA, bool) {
	// Rounded square, radius 16.
	if !inRoundRect(x, y, 64, 16) {
		return color.NRGBA{}, false
	}
	c := ic.bg
	// Ring: center (29, 29), radius 14.5, stroke 7, diagonal gradient.
	if d := math.Hypot(x-29, y-29); math.Abs(d-14.5) <= 3.5 {
		c = lerp(ic.from, ic.to, (x+y-22)/42)
	}
	// Status dot with a background-colored gap.
	d := math.Hypot(x-45, y-45)
	if d <= 10 {
		c = ic.bg
	}
	if d <= 6.5 {
		c = ic.dot
	}
	return c, true
}

// render supersamples 4x4 per pixel for smooth edges.
func (ic icon) render(size int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	const ss = 4
	scale := 64 / float64(size)
	for py := 0; py < size; py++ {
		for px := 0; px < size; px++ {
			var r, g, b, a float64
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					x := (float64(px) + (float64(sx)+0.5)/ss) * scale
					y := (float64(py) + (float64(sy)+0.5)/ss) * scale
					if c, ok := ic.shade(x, y); ok {
						r += float64(c.R)
						g += float64(c.G)
						b += float64(c.B)
						a++
					}
				}
			}
			if a == 0 {
				continue
			}
			img.SetNRGBA(px, py, color.NRGBA{uint8(r / a), uint8(g / a), uint8(b / a), uint8(a / ss / ss * 255)})
		}
	}
	return img
}

func inRoundRect(x, y, size, r float64) bool {
	if x < 0 || y < 0 || x > size || y > size {
		return false
	}
	cx := math.Min(math.Max(x, r), size-r)
	cy := math.Min(math.Max(y, r), size-r)
	return math.Hypot(x-cx, y-cy) <= r
}

func lerp(a, b color.NRGBA, t float64) color.NRGBA {
	t = math.Min(1, math.Max(0, t))
	l := func(x, y uint8) uint8 { return uint8(float64(x)*(1-t) + float64(y)*t) }
	return color.NRGBA{l(a.R, b.R), l(a.G, b.G), l(a.B, b.B), 255}
}

func hex(s string) color.NRGBA {
	n, err := strconv.ParseUint(s[1:], 16, 32)
	if len(s) != 7 || err != nil {
		log.Fatalf("bad color %q (use #rrggbb)", s)
	}
	return color.NRGBA{uint8(n >> 16), uint8(n >> 8), uint8(n), 255}
}

func writePNG(path string, img image.Image) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		log.Fatal(err)
	}
	log.Println("wrote", path)
}

// ico packs PNG images into a .ico file (PNG entries are valid since Vista).
func ico(imgs ...*image.NRGBA) []byte {
	var body [][]byte
	for _, im := range imgs {
		var b bytes.Buffer
		png.Encode(&b, im)
		body = append(body, b.Bytes())
	}
	var out bytes.Buffer
	binary.Write(&out, binary.LittleEndian, []uint16{0, 1, uint16(len(imgs))})
	offset := 6 + 16*len(imgs)
	for i, im := range imgs {
		w := im.Bounds().Dx()
		out.Write([]byte{byte(w % 256), byte(w % 256), 0, 0})
		binary.Write(&out, binary.LittleEndian, []uint16{1, 32})
		binary.Write(&out, binary.LittleEndian, []uint32{uint32(len(body[i])), uint32(offset)})
		offset += len(body[i])
	}
	for _, b := range body {
		out.Write(b)
	}
	return out.Bytes()
}
