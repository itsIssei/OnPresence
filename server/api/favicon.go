package api

import (
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"onpresence/server/models"
	"onpresence/server/services"
)

// importFavicon downloads a site's icon once and saves it in the media
// library, so the card never loads third-party favicons in visitors' browsers.
func (s *Server) importFavicon(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("url"))
	if raw == "" || len(raw) > 500 {
		writeError(w, http.StatusBadRequest, "Link URL required")
		return
	}
	data, ext, err := services.FetchSiteIcon(raw)
	if err != nil {
		slog.Warn("site icon fetch failed", "err", err)
		writeError(w, http.StatusBadGateway, "Could not find an icon for that site. Upload one instead.")
		return
	}
	host := "site"
	if u, err := url.Parse(raw); err == nil && u.Host != "" {
		host = u.Host
	}
	up := models.Upload{Name: models.Truncate(host+" icon"+ext, 120)}
	data, ext, up.Width, up.Height, err = processImage(data, ext)
	if err != nil {
		writeError(w, http.StatusBadGateway, "That site's icon is not a valid image. Upload one instead.")
		return
	}
	up.Mime = mime.TypeByExtension(ext)
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
