package store

import (
	"context"
	"database/sql"
	"strings"

	"onpresence/server/models"
)

// ImportKeys are the identities of the entries that already exist, used to
// mark and skip duplicates when importing a library.
type ImportKeys struct {
	SteamApps map[int]bool    // games with a Steam app id
	Titles    map[string]bool // lower-case titles of games without one
	AniList   map[int]bool    // media with an AniList id
}

func titleKey(t string) string { return strings.ToLower(strings.TrimSpace(t)) }

// HasGame reports whether a game with this app id (or, for an old game
// without an app id, this title) exists.
func (k *ImportKeys) HasGame(appID int, title string) bool {
	return (appID > 0 && k.SteamApps[appID]) || k.Titles[titleKey(title)]
}

type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func importKeys(ctx context.Context, q queryer) (*ImportKeys, error) {
	k := &ImportKeys{SteamApps: map[int]bool{}, Titles: map[string]bool{}, AniList: map[int]bool{}}
	rows, err := q.QueryContext(ctx, `SELECT steam_appid, title FROM games`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int
		var title string
		if err := rows.Scan(&id, &title); err != nil {
			rows.Close()
			return nil, err
		}
		if id > 0 {
			k.SteamApps[id] = true
		} else {
			k.Titles[titleKey(title)] = true
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	rows, err = q.QueryContext(ctx, `SELECT anilist_id FROM media WHERE anilist_id > 0`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		k.AniList[id] = true
	}
	return k, rows.Err()
}

// ImportKeys returns the identities of the existing games and media.
func (s *Store) ImportKeys(ctx context.Context) (*ImportKeys, error) {
	return importKeys(ctx, s.DB)
}

// BulkAddGames adds games in one transaction, after the existing ones
// (sort_order). A game whose app id (or title, for old entries without an app
// id) exists, or repeats inside the batch, is skipped. The caller validates.
func (s *Store) BulkAddGames(ctx context.Context, items []models.Game) (added, skipped int, err error) {
	err = s.tx(ctx, func(tx *sql.Tx) error {
		added, skipped = 0, 0
		keys, err := importKeys(ctx, tx)
		if err != nil {
			return err
		}
		var next int
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM games`).Scan(&next); err != nil {
			return err
		}
		for _, x := range items {
			if keys.HasGame(x.SteamAppID, x.Title) {
				skipped++
				continue
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO games (title, subtitle, cover_image, rating, badge, badge_type, hours_played, category, review_note, is_featured, sort_order, status, steam_appid, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
				x.Title, x.Subtitle, x.CoverImage, x.Rating, x.Badge, x.BadgeType, x.HoursPlayed, x.Category, x.ReviewNote, next, x.Status, x.SteamAppID, now()); err != nil {
				return err
			}
			keys.SteamApps[x.SteamAppID] = true
			next++
			added++
		}
		return nil
	})
	return
}

// BulkAddMedia is BulkAddGames for anime and manga, deduplicated by AniList id.
func (s *Store) BulkAddMedia(ctx context.Context, items []models.Media) (added, skipped int, err error) {
	err = s.tx(ctx, func(tx *sql.Tx) error {
		added, skipped = 0, 0
		keys, err := importKeys(ctx, tx)
		if err != nil {
			return err
		}
		var next int
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM media`).Scan(&next); err != nil {
			return err
		}
		for _, x := range items {
			if keys.AniList[x.AniListID] {
				skipped++
				continue
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO media (title, type, cover_image, rating, rank_badge, category_badge, progress_info, review_note, anilist_id, tags, is_featured, sort_order, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
				x.Title, x.Type, x.CoverImage, x.Rating, x.RankBadge, x.CategoryBadge, x.ProgressInfo, x.ReviewNote, x.AniListID, x.Tags, next, x.Status, now()); err != nil {
				return err
			}
			keys.AniList[x.AniListID] = true
			next++
			added++
		}
		return nil
	})
	return
}
