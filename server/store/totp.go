package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"onpresence/server/totp"
)

// Two-factor authentication (TOTP) for admin accounts.
//
// totp_pending holds a secret between "start setup" and "confirm with a
// code"; totp_secret is only set once the first code was verified, so a
// half-finished setup never locks anyone out. totp_last_step stops a code
// from being used twice.

var ErrBadCode = errors.New("invalid code")

const recoveryCodeCount = 10

// TOTPEnabled reports whether username has two-factor authentication on.
func (s *Store) TOTPEnabled(ctx context.Context, username string) (bool, error) {
	var secret string
	err := s.DB.QueryRowContext(ctx, `SELECT totp_secret FROM admin_users WHERE username = ?`, username).Scan(&secret)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return secret != "", err
}

// BeginTOTP stores a new pending secret and returns it.
func (s *Store) BeginTOTP(ctx context.Context, username string) (string, error) {
	secret := totp.NewSecret()
	_, err := s.DB.ExecContext(ctx, `UPDATE admin_users SET totp_pending = ? WHERE username = ?`, secret, username)
	return secret, err
}

// EnableTOTP verifies code against the pending secret, turns 2FA on and
// returns fresh single-use recovery codes (shown to the user once).
func (s *Store) EnableTOTP(ctx context.Context, username, code string) ([]string, error) {
	var pending string
	if err := s.DB.QueryRowContext(ctx, `SELECT totp_pending FROM admin_users WHERE username = ?`, username).Scan(&pending); err != nil {
		return nil, err
	}
	if pending == "" {
		return nil, ErrBadCode
	}
	step, ok := totp.Verify(pending, code, time.Now())
	if !ok {
		return nil, ErrBadCode
	}
	codes := make([]string, recoveryCodeCount)
	err := s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE admin_users SET totp_secret = totp_pending, totp_pending = '', totp_last_step = ? WHERE username = ?`, step, username); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM recovery_codes WHERE username = ?`, username); err != nil {
			return err
		}
		for i := range codes {
			c := strings.ToLower(RandomPassword()[:10])
			codes[i] = c[:5] + "-" + c[5:]
			if _, err := tx.ExecContext(ctx, `INSERT INTO recovery_codes (username, code_hash) VALUES (?, ?)`, username, hashToken(normalizeRecovery(codes[i]))); err != nil {
				return err
			}
		}
		return nil
	})
	return codes, err
}

// DisableTOTP turns 2FA off and deletes recovery codes.
func (s *Store) DisableTOTP(ctx context.Context, username string) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE admin_users SET totp_secret = '', totp_pending = '', totp_last_step = 0 WHERE username = ?`, username); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM recovery_codes WHERE username = ?`, username)
		return err
	})
}

// CheckSecondFactor accepts a current authenticator code (each code works
// once) or an unused recovery code (deleted when used).
func (s *Store) CheckSecondFactor(ctx context.Context, username, code string) error {
	code = strings.TrimSpace(code)
	var secret string
	var last int64
	if err := s.DB.QueryRowContext(ctx, `SELECT totp_secret, totp_last_step FROM admin_users WHERE username = ?`, username).Scan(&secret, &last); err != nil {
		return ErrBadCode
	}
	if secret == "" {
		return nil
	}
	if step, ok := totp.Verify(secret, code, time.Now()); ok {
		// Conditional update: a replayed or concurrent use of the same code fails.
		res, err := s.DB.ExecContext(ctx, `UPDATE admin_users SET totp_last_step = ? WHERE username = ? AND totp_last_step < ?`, step, username, step)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 1 {
			return nil
		}
		return ErrBadCode
	}
	if len(code) >= 10 {
		res, err := s.DB.ExecContext(ctx, `DELETE FROM recovery_codes WHERE username = ? AND code_hash = ?`, username, hashToken(normalizeRecovery(code)))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 1 {
			return nil
		}
	}
	return ErrBadCode
}

// RecoveryCodesLeft returns how many unused recovery codes username has.
func (s *Store) RecoveryCodesLeft(ctx context.Context, username string) int {
	var n int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM recovery_codes WHERE username = ?`, username).Scan(&n)
	return n
}

func normalizeRecovery(c string) string {
	return strings.ToLower(strings.NewReplacer("-", "", " ", "").Replace(c))
}
