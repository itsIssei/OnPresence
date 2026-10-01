package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"onpresence/server/models"
)

// ErrNotFound is returned when an update or delete matches no row.
var ErrNotFound = errors.New("not found")

// Collection names accepted by Delete and Reorder. Keys are API names, values
// are table names; anything else is rejected before it reaches SQL.
var collectionTables = map[string]string{
	"links":     "social_links",
	"badges":    "badges",
	"games":     "games",
	"media":     "media",
	"playlists": "playlists",
	"referrals": "referrals",
}

func tableFor(collection string) (string, error) {
	t, ok := collectionTables[collection]
	if !ok {
		return "", fmt.Errorf("unknown collection %q", collection)
	}
	return t, nil
}

// Delete removes one row from a collection.
func (s *Store) Delete(ctx context.Context, collection string, id int64) error {
	t, err := tableFor(collection)
	if err != nil {
		return err
	}
	res, err := s.DB.ExecContext(ctx, `DELETE FROM `+t+` WHERE id = ?`, id)
	if err != nil {
		return err
	}
	return mustAffect(res)
}

// Reorder sets sort_order to the index of each id in ids.
func (s *Store) Reorder(ctx context.Context, collection string, ids []int64) error {
	t, err := tableFor(collection)
	if err != nil {
		return err
	}
	return s.tx(ctx, func(tx *sql.Tx) error {
		for i, id := range ids {
			if _, err := tx.ExecContext(ctx, `UPDATE `+t+` SET sort_order = ? WHERE id = ?`, i, id); err != nil {
				return err
			}
		}
		return nil
	})
}

func mustAffect(res sql.Result) error {
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return ErrNotFound
	}
	return nil
}

// upsert runs update when id > 0 (ErrNotFound if missing), else insert and
// returns the new id.
func (s *Store) upsert(ctx context.Context, id int64, update string, insert string, args ...any) (int64, error) {
	if id > 0 {
		res, err := s.DB.ExecContext(ctx, update, append(args, id)...)
		if err != nil {
			return 0, err
		}
		return id, mustAffect(res)
	}
	res, err := s.DB.ExecContext(ctx, insert, args...)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ---------------------------------------------------------------- links

func (s *Store) Links(ctx context.Context, activeOnly bool) ([]models.SocialLink, error) {
	q := `SELECT id, platform, label, url, copy_text, icon, sort_order, is_active, clicks FROM social_links`
	if activeOnly {
		q += ` WHERE is_active = 1`
	}
	rows, err := s.DB.QueryContext(ctx, q+` ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.SocialLink{}
	for rows.Next() {
		var x models.SocialLink
		if err := rows.Scan(&x.ID, &x.Platform, &x.Label, &x.URL, &x.CopyText, &x.Icon, &x.SortOrder, &x.IsActive, &x.Clicks); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) SaveLink(ctx context.Context, x *models.SocialLink) error {
	id, err := s.upsert(ctx, x.ID,
		`UPDATE social_links SET platform=?, label=?, url=?, copy_text=?, icon=?, sort_order=?, is_active=? WHERE id=?`,
		`INSERT INTO social_links (platform, label, url, copy_text, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		x.Platform, x.Label, x.URL, x.CopyText, x.Icon, x.SortOrder, b2i(x.IsActive))
	x.ID = id
	return err
}

// LinkClick increments the counter of an active link. It returns the target
// URL, and copy=true for links that copy text instead of opening a page.
func (s *Store) LinkClick(ctx context.Context, id int64) (url string, copy bool, err error) {
	var text string
	err = s.DB.QueryRowContext(ctx, `UPDATE social_links SET clicks = clicks + 1 WHERE id = ? AND is_active = 1 RETURNING url, copy_text`, id).Scan(&url, &text)
	if err == sql.ErrNoRows {
		return "", false, ErrNotFound
	}
	return url, text != "", err
}

// ---------------------------------------------------------------- badges

func (s *Store) Badges(ctx context.Context) ([]models.Badge, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, title, subtitle, icon, color, category, sort_order FROM badges ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Badge{}
	for rows.Next() {
		var x models.Badge
		if err := rows.Scan(&x.ID, &x.Title, &x.Subtitle, &x.Icon, &x.Color, &x.Category, &x.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) SaveBadge(ctx context.Context, x *models.Badge) error {
	id, err := s.upsert(ctx, x.ID,
		`UPDATE badges SET title=?, subtitle=?, icon=?, color=?, category=?, sort_order=? WHERE id=?`,
		`INSERT INTO badges (title, subtitle, icon, color, category, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
		x.Title, x.Subtitle, x.Icon, x.Color, x.Category, x.SortOrder)
	x.ID = id
	return err
}

// ---------------------------------------------------------------- games

func (s *Store) Games(ctx context.Context) ([]models.Game, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, title, subtitle, cover_image, rating, badge, badge_type, hours_played, category, review_note, is_featured, sort_order, created_at
		FROM games ORDER BY is_featured DESC, sort_order, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Game{}
	for rows.Next() {
		var x models.Game
		if err := rows.Scan(&x.ID, &x.Title, &x.Subtitle, &x.CoverImage, &x.Rating, &x.Badge, &x.BadgeType, &x.HoursPlayed, &x.Category, &x.ReviewNote, &x.IsFeatured, &x.SortOrder, &x.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) SaveGame(ctx context.Context, x *models.Game) error {
	if x.ID == 0 {
		x.CreatedAt = now()
	}
	id, err := s.upsert(ctx, x.ID,
		`UPDATE games SET title=?, subtitle=?, cover_image=?, rating=?, badge=?, badge_type=?, hours_played=?, category=?, review_note=?, is_featured=?, sort_order=? WHERE id=?`,
		`INSERT INTO games (title, subtitle, cover_image, rating, badge, badge_type, hours_played, category, review_note, is_featured, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
		x.Title, x.Subtitle, x.CoverImage, x.Rating, x.Badge, x.BadgeType, x.HoursPlayed, x.Category, x.ReviewNote, b2i(x.IsFeatured), x.SortOrder)
	x.ID = id
	return err
}

// ---------------------------------------------------------------- media (anime / manga / manhwa)

func (s *Store) Media(ctx context.Context) ([]models.Media, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, title, type, cover_image, rating, rank_badge, category_badge, progress_info, review_note, anilist_id, tags, is_featured, sort_order, created_at
		FROM media ORDER BY is_featured DESC, sort_order, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Media{}
	for rows.Next() {
		var x models.Media
		if err := rows.Scan(&x.ID, &x.Title, &x.Type, &x.CoverImage, &x.Rating, &x.RankBadge, &x.CategoryBadge, &x.ProgressInfo, &x.ReviewNote, &x.AniListID, &x.Tags, &x.IsFeatured, &x.SortOrder, &x.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) SaveMedia(ctx context.Context, x *models.Media) error {
	if x.ID == 0 {
		x.CreatedAt = now()
	}
	id, err := s.upsert(ctx, x.ID,
		`UPDATE media SET title=?, type=?, cover_image=?, rating=?, rank_badge=?, category_badge=?, progress_info=?, review_note=?, anilist_id=?, tags=?, is_featured=?, sort_order=? WHERE id=?`,
		`INSERT INTO media (title, type, cover_image, rating, rank_badge, category_badge, progress_info, review_note, anilist_id, tags, is_featured, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
		x.Title, x.Type, x.CoverImage, x.Rating, x.RankBadge, x.CategoryBadge, x.ProgressInfo, x.ReviewNote, x.AniListID, x.Tags, b2i(x.IsFeatured), x.SortOrder)
	x.ID = id
	return err
}

// ---------------------------------------------------------------- referrals

func (s *Store) Referrals(ctx context.Context, activeOnly bool) ([]models.Referral, error) {
	q := `SELECT id, kind, title, game_name, ref_code, ref_url, image_url, description, reward_text, badge, display_style, sort_order, is_active, created_at FROM referrals`
	if activeOnly {
		q += ` WHERE is_active = 1`
	}
	rows, err := s.DB.QueryContext(ctx, q+` ORDER BY sort_order, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Referral{}
	for rows.Next() {
		var x models.Referral
		if err := rows.Scan(&x.ID, &x.Kind, &x.Title, &x.GameName, &x.RefCode, &x.RefURL, &x.ImageURL, &x.Description, &x.RewardText, &x.Badge, &x.DisplayStyle, &x.SortOrder, &x.IsActive, &x.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) SaveReferral(ctx context.Context, x *models.Referral) error {
	if x.ID == 0 {
		x.CreatedAt = now()
	}
	id, err := s.upsert(ctx, x.ID,
		`UPDATE referrals SET kind=?, title=?, game_name=?, ref_code=?, ref_url=?, image_url=?, description=?, reward_text=?, badge=?, display_style=?, sort_order=?, is_active=? WHERE id=?`,
		`INSERT INTO referrals (kind, title, game_name, ref_code, ref_url, image_url, description, reward_text, badge, display_style, sort_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
		x.Kind, x.Title, x.GameName, x.RefCode, x.RefURL, x.ImageURL, x.Description, x.RewardText, x.Badge, x.DisplayStyle, x.SortOrder, b2i(x.IsActive))
	x.ID = id
	return err
}

// ---------------------------------------------------------------- playlists

func (s *Store) Playlists(ctx context.Context) ([]models.Playlist, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, title, subtitle, type, cover_image, spotify_url, yt_music_url, audio_url, duration, artist, is_featured, sort_order, created_at
		FROM playlists ORDER BY is_featured DESC, sort_order, id DESC`)
	if err != nil {
		return nil, err
	}
	out := []models.Playlist{}
	index := map[int64]int{}
	for rows.Next() {
		var x models.Playlist
		if err := rows.Scan(&x.ID, &x.Title, &x.Subtitle, &x.Type, &x.CoverImage, &x.SpotifyURL, &x.YTMusicURL, &x.AudioURL, &x.Duration, &x.Artist, &x.IsFeatured, &x.SortOrder, &x.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		x.Tracks = []models.Track{}
		index[x.ID] = len(out)
		out = append(out, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// One query for all tracks instead of one per playlist.
	trows, err := s.DB.QueryContext(ctx, `SELECT id, playlist_id, track_number, title, artist, duration, audio_url FROM tracks ORDER BY playlist_id, sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer trows.Close()
	for trows.Next() {
		var t models.Track
		var pid int64
		if err := trows.Scan(&t.ID, &pid, &t.TrackNumber, &t.Title, &t.Artist, &t.Duration, &t.AudioURL); err != nil {
			return nil, err
		}
		if i, ok := index[pid]; ok {
			out[i].Tracks = append(out[i].Tracks, t)
		}
	}
	return out, trows.Err()
}

// SavePlaylist upserts the playlist and replaces its track list.
func (s *Store) SavePlaylist(ctx context.Context, x *models.Playlist) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		args := []any{x.Title, x.Subtitle, x.Type, x.CoverImage, x.SpotifyURL, x.YTMusicURL, x.AudioURL, x.Duration, x.Artist, b2i(x.IsFeatured), x.SortOrder}
		if x.ID > 0 {
			res, err := tx.ExecContext(ctx, `UPDATE playlists SET title=?, subtitle=?, type=?, cover_image=?, spotify_url=?, yt_music_url=?, audio_url=?, duration=?, artist=?, is_featured=?, sort_order=? WHERE id=?`,
				append(args, x.ID)...)
			if err != nil {
				return err
			}
			if err := mustAffect(res); err != nil {
				return err
			}
		} else {
			x.CreatedAt = now()
			res, err := tx.ExecContext(ctx, `INSERT INTO playlists (title, subtitle, type, cover_image, spotify_url, yt_music_url, audio_url, duration, artist, is_featured, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				append(args, x.CreatedAt)...)
			if err != nil {
				return err
			}
			x.ID, _ = res.LastInsertId()
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM tracks WHERE playlist_id = ?`, x.ID); err != nil {
			return err
		}
		for i := range x.Tracks {
			t := &x.Tracks[i]
			res, err := tx.ExecContext(ctx, `INSERT INTO tracks (playlist_id, track_number, title, artist, duration, audio_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				x.ID, t.TrackNumber, t.Title, t.Artist, t.Duration, t.AudioURL, i)
			if err != nil {
				return err
			}
			t.ID, _ = res.LastInsertId()
		}
		return nil
	})
}
