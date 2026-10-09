package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"onpresence/server/models"
)

// ErrSlugTaken is returned when a short link name is already in use.
var ErrSlugTaken = errors.New("short link name already in use")

func (s *Store) ShortLinks(ctx context.Context) ([]models.ShortLink, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, slug, url, note, clicks, is_active, sort_order, created_at FROM short_links ORDER BY sort_order, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.ShortLink{}
	for rows.Next() {
		var x models.ShortLink
		if err := rows.Scan(&x.ID, &x.Slug, &x.URL, &x.Note, &x.Clicks, &x.IsActive, &x.SortOrder, &x.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// SaveShortLink inserts or updates x. A slug that another row already uses
// gives ErrSlugTaken.
func (s *Store) SaveShortLink(ctx context.Context, x *models.ShortLink) error {
	if x.ID == 0 {
		x.CreatedAt = now()
	}
	id, err := s.upsert(ctx, x.ID,
		`UPDATE short_links SET slug=?, url=?, note=?, is_active=?, sort_order=? WHERE id=?`,
		`INSERT INTO short_links (slug, url, note, is_active, sort_order, created_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
		x.Slug, x.URL, x.Note, b2i(x.IsActive), x.SortOrder)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrSlugTaken
	}
	x.ID = id
	return err
}

// ShortLinkClick counts a visit and returns the target of an active short
// link. ErrNotFound when the slug is unknown or switched off.
func (s *Store) ShortLinkClick(ctx context.Context, slug string) (string, error) {
	var url string
	err := s.DB.QueryRowContext(ctx, `UPDATE short_links SET clicks = clicks + 1 WHERE slug = ? AND is_active = 1 RETURNING url`, slug).Scan(&url)
	if err == sql.ErrNoRows {
		return "", ErrNotFound
	}
	return url, err
}
