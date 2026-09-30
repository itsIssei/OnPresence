package api

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // registers webp for image.DecodeConfig

	"onpresence/server/models"
)

const (
	maxUploadBytes = 25 << 20 // 25 MB (audio/video)
	maxImageSide   = 2048     // larger JPEG/PNG images are downscaled
)

// Allowed extensions and the sniffed content types each may have.
var uploadTypes = map[string][]string{
	".png":  {"image/png"},
	".jpg":  {"image/jpeg"},
	".jpeg": {"image/jpeg"},
	".gif":  {"image/gif"},
	".webp": {"image/webp"},
	".mp3":  {"audio/mpeg", "application/octet-stream"},
	".ogg":  {"application/ogg", "audio/ogg"},
	".wav":  {"audio/wave", "audio/wav"},
	".mp4":  {"video/mp4"},
	".webm": {"video/webm"},
}

func (s *Server) listUploads(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Uploads(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+1<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeError(w, http.StatusRequestEntityTooLarge, "File too large (max 25 MB)")
		} else {
			writeError(w, http.StatusBadRequest, "No file uploaded")
		}
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	allowed, ok := uploadTypes[ext]
	if !ok {
		writeError(w, http.StatusBadRequest, "Unsupported file type")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Could not read file")
		return
	}
	if len(data) > maxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "File too large (max 25 MB)")
		return
	}
	sniffed := http.DetectContentType(data)
	if !contains(allowed, sniffed) {
		writeError(w, http.StatusBadRequest, "File content does not match its extension")
		return
	}

	up := models.Upload{Name: models.Truncate(filepath.Base(header.Filename), 120), Mime: mime.TypeByExtension(ext)}
	if strings.HasPrefix(up.Mime, "image/") {
		data, ext, up.Width, up.Height, err = processImage(data, ext)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid image")
			return
		}
		up.Mime = mime.TypeByExtension(ext)
	}
	up.Size = int64(len(data))

	name := randomName() + ext
	if err := os.MkdirAll(s.cfg.UploadsDir(), 0o750); err != nil {
		serverError(w, r, err)
		return
	}
	if err := os.WriteFile(filepath.Join(s.cfg.UploadsDir(), name), data, 0o640); err != nil {
		serverError(w, r, err)
		return
	}
	if err := s.store.AddUpload(r.Context(), name, &up); err != nil {
		os.Remove(filepath.Join(s.cfg.UploadsDir(), name))
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, up)
}

// processImage re-encodes JPEG and PNG (drops EXIF/GPS metadata, downscales
// huge images). GIF and WebP are kept as-is to preserve animation.
func processImage(data []byte, ext string) ([]byte, string, int, int, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, err
	}
	if cfg.Width*cfg.Height > 50_000_000 {
		return nil, "", 0, 0, errors.New("image too large")
	}
	if ext == ".gif" || ext == ".webp" {
		if ext == ".gif" {
			if _, err := gif.DecodeAll(bytes.NewReader(data)); err != nil {
				return nil, "", 0, 0, err
			}
		}
		return data, ext, cfg.Width, cfg.Height, nil
	}

	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, err
	}
	b := img.Bounds()
	wd, ht := b.Dx(), b.Dy()
	if wd > maxImageSide || ht > maxImageSide {
		scale := float64(maxImageSide) / float64(max(wd, ht))
		nw, nh := int(float64(wd)*scale), int(float64(ht)*scale)
		dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
		draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)
		img, wd, ht = dst, nw, nh
	}
	var buf bytes.Buffer
	if ext == ".png" {
		err = (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, img)
	} else {
		ext = ".jpg"
		err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: 88})
	}
	return buf.Bytes(), ext, wd, ht, err
}

func (s *Server) deleteUpload(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if r.URL.Query().Get("force") != "1" {
		list, err := s.store.Uploads(r.Context())
		if err != nil {
			serverError(w, r, err)
			return
		}
		for _, u := range list {
			if u.ID != id {
				continue
			}
			inUse, err := s.store.UploadInUse(r.Context(), u.URL)
			if err != nil {
				serverError(w, r, err)
				return
			}
			if inUse {
				writeError(w, http.StatusConflict, "File is still used by your profile or display case")
				return
			}
		}
	}
	if err := s.store.DeleteUpload(r.Context(), s.cfg.UploadsDir(), id); err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

var uploadFileName = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,128}$`)

// serveUpload serves user files with a locked-down CSP so a crafted file can
// never run script on this origin. Names are random, so cache forever.
func (s *Server) serveUpload(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !uploadFileName.MatchString(name) || strings.HasPrefix(name, ".") {
		http.NotFound(w, r)
		return
	}
	ext := strings.ToLower(filepath.Ext(name))
	if _, ok := uploadTypes[ext]; !ok {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(filepath.Join(s.cfg.UploadsDir(), name))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil || fi.IsDir() {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", mime.TypeByExtension(ext))
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(w, r, name, fi.ModTime(), f)
}

func randomName() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
