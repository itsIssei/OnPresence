package api

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"runtime/debug"
	"strings"
	"time"

	"onpresence/server/store"
)

// contentSecurityPolicy for HTML pages. Scripts only from self (Vite build has
// no inline scripts). Images/media from https for covers and decoration packs.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"font-src 'self' data:; " +
	"img-src 'self' data: blob: https:; " +
	"media-src 'self' blob: https:; " +
	"connect-src 'self' https://api.lanyard.rest wss://api.lanyard.rest; " +
	"frame-src https://open.spotify.com https://www.youtube-nocookie.com; " +
	"object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		next.ServeHTTP(w, r)
	})
}

// sameOriginWrite blocks cross-site state-changing API requests (CSRF).
// Browsers send Sec-Fetch-Site; older ones send Origin.
func sameOriginWrite(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		return true
	}
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" {
		return site == "same-origin" || site == "none"
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // non-browser client; cookie auth still applies
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host == r.Host
}

func csrf(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !sameOriginWrite(r) {
			writeError(w, http.StatusForbidden, "Cross-site request blocked")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Unwrap lets http.ResponseController reach the real writer.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// logRequests logs API calls and errors; static asset hits are skipped.
func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		defer func() {
			if p := recover(); p != nil {
				slog.Error("panic", "err", p, "path", r.URL.Path, "stack", string(debug.Stack()))
				writeError(rec, http.StatusInternalServerError, "Internal error")
			}
			if strings.HasPrefix(r.URL.Path, "/api/") || rec.status >= 400 {
				slog.Info("http", "method", r.Method, "path", r.URL.Path, "status", rec.status,
					"dur_ms", time.Since(start).Milliseconds(), "ip", s.clientIP(r))
			}
		}()
		next.ServeHTTP(rec, r)
	})
}

// clientIP returns the peer address, walking X-Forwarded-For from the right
// only while each hop is a trusted proxy, so clients cannot spoof it.
func (s *Server) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer := net.ParseIP(host)
	if peer == nil || !s.trusted(peer) {
		return host
	}
	hops := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		ip := net.ParseIP(strings.TrimSpace(hops[i]))
		if ip == nil {
			break
		}
		if !s.trusted(ip) {
			return ip.String()
		}
	}
	return host
}

func (s *Server) trusted(ip net.IP) bool {
	for _, n := range s.cfg.TrustedProxies {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

func (s *Server) isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return s.trusted(net.ParseIP(host)) && r.Header.Get("X-Forwarded-Proto") == "https"
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const sessionCookie = "onpresence_session"

type ctxKey int

const sessionKey ctxKey = 0

func sessionFrom(ctx context.Context) store.SessionInfo {
	info, _ := ctx.Value(sessionKey).(store.SessionInfo)
	return info
}

// admin wraps h so it only runs for a valid session.
func (s *Server) admin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		info, ok := s.store.LookupSession(r.Context(), c.Value)
		if !ok {
			s.clearCookie(w, r)
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		h(w, r.WithContext(context.WithValue(r.Context(), sessionKey, info)))
	}
}

func (s *Server) setCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(s.cfg.SessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.isHTTPS(r),
		SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) clearCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.isHTTPS(r), SameSite: http.SameSiteStrictMode,
	})
}
