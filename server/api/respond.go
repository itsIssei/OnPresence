package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"onpresence/server/store"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// serverError logs err and sends a generic 500 (or 404 for ErrNotFound).
func serverError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}
	slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, "Internal error")
}

// decode reads a JSON body of at most maxBytes into v.
func decode(w http.ResponseWriter, r *http.Request, v any, maxBytes int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeError(w, http.StatusRequestEntityTooLarge, "Request body too large")
		} else if errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "Empty request body")
		} else {
			writeError(w, http.StatusBadRequest, "Invalid JSON")
		}
		return false
	}
	return true
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "Invalid id")
		return 0, false
	}
	return id, true
}

// validationError collects field errors for a 400 response.
type validationError map[string]string

func (v validationError) add(field, msg string) { v[field] = msg }

func (v validationError) respond(w http.ResponseWriter) bool {
	if len(v) == 0 {
		return false
	}
	writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Validation failed", "fields": v})
	return true
}
