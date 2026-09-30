package api

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"onpresence/server/store"
	"onpresence/server/totp"
)

var usernameFmt = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,32}$`)

// loginAllowed applies the per-IP and global failed-login limits.
func (s *Server) loginAllowed(w http.ResponseWriter, ip string) bool {
	if s.loginIP.Blocked(ip) || s.loginGlobal.Blocked("all") {
		w.Header().Set("Retry-After", "900")
		writeError(w, http.StatusTooManyRequests, "Too many failed attempts. Try again in 15 minutes.")
		return false
	}
	return true
}

func (s *Server) loginFailed(ip string) {
	s.loginIP.Fail(ip)
	s.loginGlobal.Fail("all")
}

// login checks username + password, then the second factor when 2FA is on.
// Without a code it answers 401 {"totp_required": true}; the client asks for
// the code and sends all three again. Every wrong attempt counts toward the
// rate limit.
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	ip := s.clientIP(r)
	if !s.loginAllowed(w, ip) {
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !decode(w, r, &req, 4<<10) {
		return
	}
	ctx := r.Context()
	if err := s.store.CheckPassword(ctx, req.Username, req.Password); err != nil {
		if !errors.Is(err, store.ErrBadCredentials) {
			serverError(w, r, err)
			return
		}
		s.loginFailed(ip)
		writeError(w, http.StatusUnauthorized, "Invalid username or password")
		return
	}
	enabled, err := s.store.TOTPEnabled(ctx, req.Username)
	if err != nil {
		serverError(w, r, err)
		return
	}
	if enabled {
		if strings.TrimSpace(req.Code) == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "Enter the code from your authenticator app", "totp_required": true})
			return
		}
		if err := s.store.CheckSecondFactor(ctx, req.Username, req.Code); err != nil {
			if !errors.Is(err, store.ErrBadCode) {
				serverError(w, r, err)
				return
			}
			s.loginFailed(ip)
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "Invalid code", "totp_required": true})
			return
		}
	}
	s.loginIP.Reset(ip)
	s.startSession(w, r, req.Username)
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, username string) {
	token, err := s.store.CreateSession(r.Context(), username, s.clientIP(r), r.UserAgent(), s.cfg.SessionTTL)
	if err != nil {
		serverError(w, r, err)
		return
	}
	s.setCookie(w, r, token)
	writeJSON(w, http.StatusOK, map[string]any{"username": username})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.store.DeleteSessionByToken(r.Context(), c.Value)
	}
	s.clearCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u := sessionFrom(r.Context()).Username
	enabled, _ := s.store.TOTPEnabled(r.Context(), u)
	writeJSON(w, http.StatusOK, map[string]any{
		"username":            u,
		"totp_enabled":        enabled,
		"recovery_codes_left": s.store.RecoveryCodesLeft(r.Context(), u),
	})
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Old string `json:"old_password"`
		New string `json:"new_password"`
	}
	if !decode(w, r, &req, 4<<10) {
		return
	}
	sess := sessionFrom(r.Context())
	err := s.store.ChangePassword(r.Context(), sess.Username, req.Old, req.New, sess.ID)
	switch {
	case errors.Is(err, store.ErrBadCredentials):
		writeError(w, http.StatusBadRequest, "Current password is incorrect")
	case err != nil && len(req.New) < store.MinPasswordLength:
		writeError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		serverError(w, r, err)
	default:
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListSessions(r.Context(), sessionFrom(r.Context()).ID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) deleteSession(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteSession(r.Context(), id); err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------- first-run setup

// setupStatus tells the dashboard whether to show the setup screen.
func (s *Server) setupStatus(w http.ResponseWriter, r *http.Request) {
	has, err := s.store.HasAdmin(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"needed": !has})
}

// setup creates the first admin account. It needs the one-time setup code
// printed in the server log, so a stranger who finds a fresh install first
// cannot claim it.
func (s *Server) setup(w http.ResponseWriter, r *http.Request) {
	ip := s.clientIP(r)
	if !s.loginAllowed(w, ip) {
		return
	}
	var req struct {
		Code     string `json:"setup_code"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &req, 4<<10) {
		return
	}
	want := s.setupCode.Load()
	if want == nil || subtle.ConstantTimeCompare([]byte(strings.TrimSpace(req.Code)), []byte(*want)) != 1 {
		s.loginFailed(ip)
		writeError(w, http.StatusForbidden, "Wrong setup code. It is printed in the server log.")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	v := validationError{}
	if !usernameFmt.MatchString(req.Username) {
		v.add("username", "3-32 letters, digits, dot, dash or underscore")
	}
	if len(req.Password) < store.MinPasswordLength {
		v.add("password", "At least 10 characters")
	}
	if v.respond(w) {
		return
	}
	err := s.store.CreateAdmin(r.Context(), req.Username, req.Password)
	if errors.Is(err, store.ErrAdminExists) {
		writeError(w, http.StatusConflict, "Setup is already done. Sign in instead.")
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	s.setupCode.Store(nil)
	s.startSession(w, r, req.Username)
}

// ---------------------------------------------------------------- two-factor

// totpBegin creates a pending secret and returns it with the otpauth URI for
// the QR code. 2FA stays off until totpEnable confirms a code.
func (s *Server) totpBegin(w http.ResponseWriter, r *http.Request) {
	u := sessionFrom(r.Context()).Username
	secret, err := s.store.BeginTOTP(r.Context(), u)
	if err != nil {
		serverError(w, r, err)
		return
	}
	issuer := "OnPresence"
	if h := hostOf(s.baseURL(r)); h != "" {
		issuer = h
	}
	writeJSON(w, http.StatusOK, map[string]string{"secret": secret, "uri": totp.URI(issuer, u, secret)})
}

func (s *Server) totpEnable(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &req, 1<<10) {
		return
	}
	codes, err := s.store.EnableTOTP(r.Context(), sessionFrom(r.Context()).Username, req.Code)
	if errors.Is(err, store.ErrBadCode) {
		writeError(w, http.StatusBadRequest, "That code did not match. Check the time on your phone and try again.")
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"recovery_codes": codes})
}

// totpDisable needs the password again, so a stolen session cannot remove 2FA.
func (s *Server) totpDisable(w http.ResponseWriter, r *http.Request) {
	ip := s.clientIP(r)
	if !s.loginAllowed(w, ip) {
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if !decode(w, r, &req, 4<<10) {
		return
	}
	u := sessionFrom(r.Context()).Username
	if err := s.store.CheckPassword(r.Context(), u, req.Password); err != nil {
		if !errors.Is(err, store.ErrBadCredentials) {
			serverError(w, r, err)
			return
		}
		s.loginFailed(ip)
		writeError(w, http.StatusBadRequest, "Password is incorrect")
		return
	}
	if err := s.store.DisableTOTP(r.Context(), u); err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func hostOf(base string) string {
	base = strings.TrimPrefix(strings.TrimPrefix(base, "https://"), "http://")
	host, _, _ := strings.Cut(base, "/")
	return host
}
