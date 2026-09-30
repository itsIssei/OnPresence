package store

import (
	"context"
	"database/sql"
	"encoding/json"

	"onpresence/server/models"
)

const profileCols = `name, handle, title, bio, avatar_url, background_url, card_bg_url, audio_url, audio_title,
	discord_id, discord_status, steam_id, steam_level, anilist_username, lastfm_username, settings, updated_at, steam_api_key, lastfm_api_key`

// snapshotKeep is how many profile snapshots are kept.
const snapshotKeep = 30

// Profile returns the owner profile and its stored API keys.
func (s *Store) Profile(ctx context.Context) (models.Profile, models.Secrets, error) {
	var p models.Profile
	var sec models.Secrets
	var settings string
	err := s.DB.QueryRowContext(ctx, `SELECT `+profileCols+` FROM profile WHERE id = 1`).Scan(
		&p.Name, &p.Handle, &p.Title, &p.Bio, &p.AvatarURL, &p.BackgroundURL, &p.CardBgURL, &p.AudioURL, &p.AudioTitle,
		&p.DiscordID, &p.DiscordStatus, &p.SteamID, &p.SteamLevel, &p.AniListUsername, &p.LastfmUsername, &settings, &p.UpdatedAt,
		&sec.SteamAPIKey, &sec.LastfmAPIKey)
	if err != nil {
		return p, sec, err
	}
	p.Settings = decodeSettings(settings)
	return p, sec, nil
}

func decodeSettings(raw string) models.Settings {
	st := models.DefaultSettings()
	_ = json.Unmarshal([]byte(raw), &st)
	st.Normalize()
	return st
}

// SaveProfile replaces the profile after saving a snapshot of the current
// one. A nil key keeps the stored key; "" clears it.
func (s *Store) SaveProfile(ctx context.Context, p models.Profile, steamKey, lastfmKey *string) error {
	p.Settings.Normalize()
	settings, err := json.Marshal(p.Settings)
	if err != nil {
		return err
	}
	return s.tx(ctx, func(tx *sql.Tx) error {
		if err := snapshotTx(ctx, tx); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE profile SET name=?, handle=?, title=?, bio=?, avatar_url=?, background_url=?, card_bg_url=?,
			audio_url=?, audio_title=?, discord_id=?, discord_status=?, steam_id=?, steam_level=?, anilist_username=?, lastfm_username=?,
			settings=?, updated_at=? WHERE id = 1`,
			p.Name, p.Handle, p.Title, p.Bio, p.AvatarURL, p.BackgroundURL, p.CardBgURL,
			p.AudioURL, p.AudioTitle, p.DiscordID, p.DiscordStatus, p.SteamID, p.SteamLevel, p.AniListUsername, p.LastfmUsername,
			string(settings), now())
		if err != nil {
			return err
		}
		if steamKey != nil {
			if _, err := tx.ExecContext(ctx, `UPDATE profile SET steam_api_key = ? WHERE id = 1`, *steamKey); err != nil {
				return err
			}
		}
		if lastfmKey != nil {
			if _, err := tx.ExecContext(ctx, `UPDATE profile SET lastfm_api_key = ? WHERE id = 1`, *lastfmKey); err != nil {
				return err
			}
		}
		return nil
	})
}

// snapshotTx copies the current profile (without API keys) into
// profile_snapshots and trims old snapshots.
func snapshotTx(ctx context.Context, tx *sql.Tx) error {
	var p models.Profile
	var settings string
	err := tx.QueryRowContext(ctx, `SELECT name, handle, title, bio, avatar_url, background_url, card_bg_url, audio_url, audio_title,
		discord_id, discord_status, steam_id, steam_level, anilist_username, lastfm_username, settings, updated_at FROM profile WHERE id = 1`).Scan(
		&p.Name, &p.Handle, &p.Title, &p.Bio, &p.AvatarURL, &p.BackgroundURL, &p.CardBgURL, &p.AudioURL, &p.AudioTitle,
		&p.DiscordID, &p.DiscordStatus, &p.SteamID, &p.SteamLevel, &p.AniListUsername, &p.LastfmUsername, &settings, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	p.Settings = decodeSettings(settings)
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO profile_snapshots (created_at, data) VALUES (?, ?)`, now(), string(data)); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM profile_snapshots WHERE id NOT IN (SELECT id FROM profile_snapshots ORDER BY id DESC LIMIT ?)`, snapshotKeep)
	return err
}

// Snapshots lists saved profile versions, newest first.
func (s *Store) Snapshots(ctx context.Context) ([]models.Snapshot, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, created_at, COALESCE(json_extract(data, '$.name'), '') FROM profile_snapshots ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Snapshot{}
	for rows.Next() {
		var x models.Snapshot
		if err := rows.Scan(&x.ID, &x.CreatedAt, &x.Name); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// RestoreSnapshot makes snapshot id the current profile. The profile it
// replaces is itself snapshotted, so a restore can be undone.
func (s *Store) RestoreSnapshot(ctx context.Context, id int64) error {
	var data string
	err := s.DB.QueryRowContext(ctx, `SELECT data FROM profile_snapshots WHERE id = ?`, id).Scan(&data)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	p := models.Profile{Settings: models.DefaultSettings()}
	if err := json.Unmarshal([]byte(data), &p); err != nil {
		return err
	}
	return s.SaveProfile(ctx, p, nil, nil)
}

// SetAvatar updates only the avatar URL.
func (s *Store) SetAvatar(ctx context.Context, url string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE profile SET avatar_url = ?, updated_at = ? WHERE id = 1`, url, now())
	return err
}

// ---------------------------------------------------------------------------
// Key/value counters (profile views).
// ---------------------------------------------------------------------------

func (s *Store) Counter(ctx context.Context, key string) int64 {
	var v int64
	s.DB.QueryRowContext(ctx, `SELECT CAST(value AS INTEGER) FROM kv WHERE key = ?`, key).Scan(&v)
	return v
}

func (s *Store) Increment(ctx context.Context, key string) (int64, error) {
	var v int64
	err := s.DB.QueryRowContext(ctx, `INSERT INTO kv (key, value) VALUES (?, '1')
		ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
		RETURNING CAST(value AS INTEGER)`, key).Scan(&v)
	return v, err
}
