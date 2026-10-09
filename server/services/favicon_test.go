package services

import (
	"bytes"
	"encoding/binary"
	"net/url"
	"testing"
)

func TestIconLinksOrder(t *testing.T) {
	base, _ := url.Parse("https://example.com/page")
	html := []byte(`<head>
		<link rel="icon" href="/favicon.ico">
		<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
		<link rel='apple-touch-icon' href='https://cdn.example.com/touch.png'>
		<link rel="mask-icon" href="/mask.svg">
		<link rel="stylesheet" href="/app.css">
		<link rel="icon" href="http://insecure.example.com/x.png">
	</head>`)
	got := iconLinks(html, base)
	want := []string{"https://cdn.example.com/touch.png", "https://example.com/icon-32.png", "https://example.com/favicon.ico"}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("candidate %d: got %s want %s", i, got[i], want[i])
		}
	}
}

func TestUsableIcon(t *testing.T) {
	png := append(append([]byte{}, pngMagic...), bytes.Repeat([]byte{1}, 40)...)
	if _, ext := usableIcon(png); ext != ".png" {
		t.Fatalf("png: %q", ext)
	}
	// .ico with one PNG entry.
	ico := []byte{0, 0, 1, 0, 1, 0}
	entry := make([]byte, 16)
	binary.LittleEndian.PutUint32(entry[8:], uint32(len(png)))
	binary.LittleEndian.PutUint32(entry[12:], 22)
	ico = append(append(ico, entry...), png...)
	if data, ext := usableIcon(ico); ext != ".png" || !bytes.Equal(data, png) {
		t.Fatalf("ico with png: %q", ext)
	}
	// .ico with BMP data, and HTML, are not usable.
	bmpIco := append([]byte{0, 0, 1, 0, 1, 0}, make([]byte, 60)...)
	if data, _ := usableIcon(bmpIco); data != nil {
		t.Fatal("bmp ico accepted")
	}
	if data, _ := usableIcon([]byte("<html>not an image</html>")); data != nil {
		t.Fatal("html accepted")
	}
	if _, _, err := FetchSiteIcon("http://example.com"); err == nil {
		t.Fatal("http link accepted")
	}
}
