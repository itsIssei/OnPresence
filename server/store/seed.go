package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"

	"onpresence/server/models"
)

// seed creates the starter profile on a brand-new database. It never touches
// an existing profile, so deleted content stays deleted.
func (s *Store) seed(ctx context.Context) error {
	var n int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM profile`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	slog.Info("seeding starter profile")

	settings, _ := json.Marshal(models.DefaultSettings())
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO profile (id, name, handle, title, bio, avatar_url, discord_status, settings, updated_at)
			VALUES (1, 'Your Name', '@you', 'Online presence', 'Edit this card in /admin.', '/img/brand/avatar.svg', 'auto', ?, ?)`,
			string(settings), now()); err != nil {
			return err
		}
		links := []models.SocialLink{
			{Platform: "github", Label: "GitHub", URL: "https://github.com", Icon: "github"},
		}
		for i, l := range links {
			if _, err := tx.ExecContext(ctx, `INSERT INTO social_links (platform, label, url, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
				l.Platform, l.Label, l.URL, l.Icon, i); err != nil {
				return err
			}
		}
		return nil
	})
}
