package store

import (
	"context"
	"database/sql"
	"encoding/json"

	"onpresence/server/models"
)

// ExportContent returns the whole site content.
func (s *Store) ExportContent(ctx context.Context) (*models.Export, error) {
	e := &models.Export{App: "onpresence", Version: models.ExportVersion}
	var err error
	if e.Profile, _, err = s.Profile(ctx); err != nil {
		return nil, err
	}
	if e.Links, err = s.Links(ctx, false); err != nil {
		return nil, err
	}
	if e.Badges, err = s.Badges(ctx); err != nil {
		return nil, err
	}
	if e.Games, err = s.Games(ctx); err != nil {
		return nil, err
	}
	if e.Media, err = s.Media(ctx); err != nil {
		return nil, err
	}
	if e.Playlists, err = s.Playlists(ctx); err != nil {
		return nil, err
	}
	if e.Referrals, err = s.Referrals(ctx, false); err != nil {
		return nil, err
	}
	return e, nil
}

// ImportContent replaces the profile and every collection with e, in one
// transaction. The caller validates e first. API keys, the admin account,
// uploads and counters are kept. The replaced profile is snapshotted.
func (s *Store) ImportContent(ctx context.Context, e *models.Export) error {
	e.Profile.Settings.Normalize()
	settings, err := json.Marshal(e.Profile.Settings)
	if err != nil {
		return err
	}
	return s.tx(ctx, func(tx *sql.Tx) error {
		if err := snapshotTx(ctx, tx); err != nil {
			return err
		}
		p := e.Profile
		if _, err := tx.ExecContext(ctx, `UPDATE profile SET name=?, handle=?, title=?, bio=?, avatar_url=?, background_url=?, card_bg_url=?,
			audio_url=?, audio_title=?, discord_id=?, discord_status=?, steam_id=?, steam_level=?, anilist_username=?, lastfm_username=?,
			settings=?, updated_at=? WHERE id = 1`,
			p.Name, p.Handle, p.Title, p.Bio, p.AvatarURL, p.BackgroundURL, p.CardBgURL,
			p.AudioURL, p.AudioTitle, p.DiscordID, p.DiscordStatus, p.SteamID, p.SteamLevel, p.AniListUsername, p.LastfmUsername,
			string(settings), now()); err != nil {
			return err
		}
		for _, t := range []string{"tracks", "playlists", "social_links", "badges", "games", "media", "referrals"} {
			if _, err := tx.ExecContext(ctx, `DELETE FROM `+t); err != nil {
				return err
			}
		}
		// ids are kept (tables are empty) so /go/{id} link URLs stay valid;
		// 0 lets SQLite pick one.
		ins := func(q string, id int64, args ...any) (int64, error) {
			var idArg any
			if id > 0 {
				idArg = id
			}
			res, err := tx.ExecContext(ctx, q, append([]any{idArg}, args...)...)
			if err != nil {
				return 0, err
			}
			return res.LastInsertId()
		}
		for _, x := range e.Links {
			if _, err := ins(`INSERT INTO social_links (id, platform, label, url, icon, sort_order, is_active, clicks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				x.ID, x.Platform, x.Label, x.URL, x.Icon, x.SortOrder, b2i(x.IsActive), x.Clicks); err != nil {
				return err
			}
		}
		for _, x := range e.Badges {
			if _, err := ins(`INSERT INTO badges (id, title, subtitle, icon, color, category, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				x.ID, x.Title, x.Subtitle, x.Icon, x.Color, x.Category, x.SortOrder); err != nil {
				return err
			}
		}
		for _, x := range e.Games {
			if _, err := ins(`INSERT INTO games (id, title, subtitle, cover_image, rating, badge, badge_type, hours_played, category, review_note, is_featured, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				x.ID, x.Title, x.Subtitle, x.CoverImage, x.Rating, x.Badge, x.BadgeType, x.HoursPlayed, x.Category, x.ReviewNote, b2i(x.IsFeatured), x.SortOrder, orNow(x.CreatedAt)); err != nil {
				return err
			}
		}
		for _, x := range e.Media {
			if _, err := ins(`INSERT INTO media (id, title, type, cover_image, rating, rank_badge, category_badge, progress_info, review_note, anilist_id, tags, is_featured, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				x.ID, x.Title, x.Type, x.CoverImage, x.Rating, x.RankBadge, x.CategoryBadge, x.ProgressInfo, x.ReviewNote, x.AniListID, x.Tags, b2i(x.IsFeatured), x.SortOrder, orNow(x.CreatedAt)); err != nil {
				return err
			}
		}
		for _, x := range e.Referrals {
			if _, err := ins(`INSERT INTO referrals (id, kind, title, game_name, ref_code, ref_url, image_url, description, reward_text, badge, display_style, sort_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				x.ID, x.Kind, x.Title, x.GameName, x.RefCode, x.RefURL, x.ImageURL, x.Description, x.RewardText, x.Badge, x.DisplayStyle, x.SortOrder, b2i(x.IsActive), orNow(x.CreatedAt)); err != nil {
				return err
			}
		}
		for _, x := range e.Playlists {
			pid, err := ins(`INSERT INTO playlists (id, title, subtitle, type, cover_image, spotify_url, yt_music_url, audio_url, duration, artist, is_featured, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				x.ID, x.Title, x.Subtitle, x.Type, x.CoverImage, x.SpotifyURL, x.YTMusicURL, x.AudioURL, x.Duration, x.Artist, b2i(x.IsFeatured), x.SortOrder, orNow(x.CreatedAt))
			if err != nil {
				return err
			}
			for i, t := range x.Tracks {
				if _, err := tx.ExecContext(ctx, `INSERT INTO tracks (playlist_id, track_number, title, artist, duration, audio_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
					pid, t.TrackNumber, t.Title, t.Artist, t.Duration, t.AudioURL, i); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func orNow(t string) string {
	if t == "" {
		return now()
	}
	return t
}
