package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"golang.org/x/crypto/bcrypt"

	"onpresence/server/models"
)

// MinPasswordLength is the minimum admin password length.
const MinPasswordLength = 10

var ErrBadCredentials = errors.New("invalid username or password")

// dummyHash makes failed lookups cost the same as a real bcrypt compare, so
// response time does not reveal whether a username exists.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("timing-equalizer"), bcrypt.DefaultCost)

// ErrAdminExists is returned by CreateAdmin once an admin account exists.
var ErrAdminExists = errors.New("admin account already exists")

// HasAdmin reports whether an admin account exists.
func (s *Store) HasAdmin(ctx context.Context) (bool, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM admin_users`).Scan(&n)
	return n > 0, err
}

// CreateAdmin creates the first admin account. It fails with ErrAdminExists
// if any admin exists, so two setup requests cannot both succeed.
func (s *Store) CreateAdmin(ctx context.Context, username, password string) error {
	if len(password) < MinPasswordLength {
		return fmt.Errorf("password must be at least %d characters", MinPasswordLength)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	res, err := s.DB.ExecContext(ctx, `INSERT INTO admin_users (username, password_hash)
		SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM admin_users)`, username, string(hash))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrAdminExists
	}
	return nil
}

// BootstrapAdmin applies ADMIN_USERNAME / ADMIN_PASSWORD from the environment.
//
//   - No admin yet and a password is set: create the admin from it.
//   - No admin yet and no password: do nothing; the dashboard shows the
//     first-run setup screen instead.
//   - Admin exists: the password is ignored unless reset is true. A reset
//     also turns off two-factor authentication and signs out every session.
func (s *Store) BootstrapAdmin(ctx context.Context, username, password string, reset bool) error {
	has, err := s.HasAdmin(ctx)
	if err != nil {
		return err
	}
	if !has {
		if password == "" {
			return nil
		}
		if err := s.CreateAdmin(ctx, username, password); err != nil {
			return fmt.Errorf("ADMIN_PASSWORD: %w", err)
		}
		slog.Info("admin user created from ADMIN_PASSWORD", "username", username)
		return nil
	}

	if reset && password != "" {
		if len(password) < MinPasswordLength {
			return fmt.Errorf("ADMIN_PASSWORD must be at least %d characters", MinPasswordLength)
		}
		if err := s.setPassword(ctx, username, password, true); err != nil {
			return err
		}
		if err := s.DisableTOTP(ctx, username); err != nil {
			return err
		}
		if _, err := s.DB.ExecContext(ctx, `DELETE FROM sessions`); err != nil {
			return err
		}
		slog.Warn("admin password reset from environment (2FA turned off); remove ADMIN_RESET_PASSWORD now", "username", username)
	}
	return nil
}

func (s *Store) setPassword(ctx context.Context, username, password string, upsert bool) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	res, err := s.DB.ExecContext(ctx, `UPDATE admin_users SET password_hash = ? WHERE username = ?`, string(hash), username)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 && upsert {
		_, err = s.DB.ExecContext(ctx, `INSERT INTO admin_users (username, password_hash) VALUES (?, ?)`, username, string(hash))
	}
	return err
}

// CheckPassword verifies credentials in constant-ish time.
func (s *Store) CheckPassword(ctx context.Context, username, password string) error {
	var hash string
	err := s.DB.QueryRowContext(ctx, `SELECT password_hash FROM admin_users WHERE username = ?`, username).Scan(&hash)
	if err == sql.ErrNoRows {
		bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
		return ErrBadCredentials
	}
	if err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return ErrBadCredentials
	}
	return nil
}

// ChangePassword verifies the old password, sets the new one and revokes all
// sessions except keepSessionID.
func (s *Store) ChangePassword(ctx context.Context, username, oldPw, newPw string, keepSessionID int64) error {
	if len(newPw) < MinPasswordLength {
		return fmt.Errorf("new password must be at least %d characters", MinPasswordLength)
	}
	if err := s.CheckPassword(ctx, username, oldPw); err != nil {
		return err
	}
	if err := s.setPassword(ctx, username, newPw, false); err != nil {
		return err
	}
	_, err := s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE username = ? AND id != ?`, username, keepSessionID)
	return err
}

// ---------------------------------------------------------------------------
// Sessions. Only the SHA-256 of the token is stored; a DB leak does not leak
// usable cookies.
// ---------------------------------------------------------------------------

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// CreateSession returns a new random token for username.
func (s *Store) CreateSession(ctx context.Context, username, ip, ua string, ttl time.Duration) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)
	t := time.Now().UTC()
	_, err := s.DB.ExecContext(ctx, `INSERT INTO sessions (token_hash, username, created_at, expires_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		hashToken(token), username, t.Format(time.RFC3339), t.Add(ttl).Format(time.RFC3339), t.Format(time.RFC3339), ip, truncateUA(ua))
	return token, err
}

// SessionInfo is the result of a successful token lookup.
type SessionInfo struct {
	ID       int64
	Username string
}

// LookupSession validates token and refreshes last_seen (at most once a minute).
func (s *Store) LookupSession(ctx context.Context, token string) (SessionInfo, bool) {
	if token == "" {
		return SessionInfo{}, false
	}
	var info SessionInfo
	var expires, lastSeen string
	err := s.DB.QueryRowContext(ctx, `SELECT id, username, expires_at, last_seen FROM sessions WHERE token_hash = ?`, hashToken(token)).
		Scan(&info.ID, &info.Username, &expires, &lastSeen)
	if err != nil {
		return SessionInfo{}, false
	}
	exp, err := time.Parse(time.RFC3339, expires)
	if err != nil || time.Now().After(exp) {
		s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, info.ID)
		return SessionInfo{}, false
	}
	if ls, err := time.Parse(time.RFC3339, lastSeen); err == nil && time.Since(ls) > time.Minute {
		s.DB.ExecContext(ctx, `UPDATE sessions SET last_seen = ? WHERE id = ?`, now(), info.ID)
	}
	return info, true
}

func (s *Store) DeleteSessionByToken(ctx context.Context, token string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, hashToken(token))
	return err
}

func (s *Store) DeleteSession(ctx context.Context, id int64) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id)
	return err
}

func (s *Store) ListSessions(ctx context.Context, currentID int64) ([]models.Session, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, created_at, expires_at, last_seen, ip, user_agent FROM sessions ORDER BY last_seen DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Session{}
	for rows.Next() {
		var x models.Session
		if err := rows.Scan(&x.ID, &x.CreatedAt, &x.ExpiresAt, &x.LastSeen, &x.IP, &x.UserAgent); err != nil {
			return nil, err
		}
		x.Current = x.ID == currentID
		out = append(out, x)
	}
	return out, rows.Err()
}

// PurgeExpiredSessions removes expired rows.
func (s *Store) PurgeExpiredSessions(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at < ?`, now())
	return err
}

// RandomPassword returns 20 characters from an unambiguous alphabet.
func RandomPassword() string {
	const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

func truncateUA(ua string) string {
	if len(ua) > 200 {
		return ua[:200]
	}
	return ua
}
