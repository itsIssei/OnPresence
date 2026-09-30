package store

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
)

// migration is one schema step. Steps run in order inside a transaction with
// foreign keys disabled (the SQLite-recommended way to rebuild tables).
// Never edit a released migration; add a new one.
type migration struct {
	version int
	name    string
	up      func(ctx context.Context, tx *sql.Tx) error
}

var migrations = []migration{
	{1, "initial schema", execSQL(schemaV1)},
}

func execSQL(q string) func(context.Context, *sql.Tx) error {
	return func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, q)
		return err
	}
}

func (s *Store) migrate(ctx context.Context) error {
	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TEXT NOT NULL
	)`); err != nil {
		return err
	}

	var current int
	if err := conn.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&current); err != nil {
		return err
	}

	for _, m := range migrations {
		if m.version <= current {
			continue
		}
		slog.Info("applying migration", "version", m.version, "name", m.name)
		if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
			return err
		}
		err := func() error {
			tx, err := conn.BeginTx(ctx, nil)
			if err != nil {
				return err
			}
			defer tx.Rollback()
			if err := m.up(ctx, tx); err != nil {
				return fmt.Errorf("migration %d (%s): %w", m.version, m.name, err)
			}
			rows, err := tx.QueryContext(ctx, `PRAGMA foreign_key_check`)
			if err != nil {
				return err
			}
			bad := rows.Next()
			rows.Close()
			if bad {
				return fmt.Errorf("migration %d left foreign key violations", m.version)
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`, m.version, m.name, now()); err != nil {
				return err
			}
			return tx.Commit()
		}()
		if _, ferr := conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`); ferr != nil && err == nil {
			err = ferr
		}
		if err != nil {
			return err
		}
	}
	return nil
}

const schemaV1 = `
CREATE TABLE profile (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	name TEXT NOT NULL DEFAULT '',
	handle TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL DEFAULT '',
	bio TEXT NOT NULL DEFAULT '',
	avatar_url TEXT NOT NULL DEFAULT '',
	background_url TEXT NOT NULL DEFAULT '',
	card_bg_url TEXT NOT NULL DEFAULT '',
	audio_url TEXT NOT NULL DEFAULT '',
	audio_title TEXT NOT NULL DEFAULT '',
	discord_id TEXT NOT NULL DEFAULT '',
	discord_status TEXT NOT NULL DEFAULT 'auto',
	steam_id TEXT NOT NULL DEFAULT '',
	steam_level TEXT NOT NULL DEFAULT '',
	steam_api_key TEXT NOT NULL DEFAULT '',
	anilist_username TEXT NOT NULL DEFAULT '',
	lastfm_username TEXT NOT NULL DEFAULT '',
	lastfm_api_key TEXT NOT NULL DEFAULT '',
	settings TEXT NOT NULL DEFAULT '{}',
	updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE profile_snapshots (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	created_at TEXT NOT NULL,
	data TEXT NOT NULL
);

CREATE TABLE social_links (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	platform TEXT NOT NULL DEFAULT '',
	label TEXT NOT NULL DEFAULT '',
	url TEXT NOT NULL DEFAULT '',
	icon TEXT NOT NULL DEFAULT '',
	sort_order INTEGER NOT NULL DEFAULT 0,
	is_active INTEGER NOT NULL DEFAULT 1,
	clicks INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE badges (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	title TEXT NOT NULL DEFAULT '',
	subtitle TEXT NOT NULL DEFAULT '',
	icon TEXT NOT NULL DEFAULT '',
	color TEXT NOT NULL DEFAULT '',
	category TEXT NOT NULL DEFAULT '',
	sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE referrals (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	kind TEXT NOT NULL DEFAULT 'referral',
	title TEXT NOT NULL DEFAULT '',
	game_name TEXT NOT NULL DEFAULT '',
	ref_code TEXT NOT NULL DEFAULT '',
	ref_url TEXT NOT NULL DEFAULT '',
	image_url TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	reward_text TEXT NOT NULL DEFAULT '',
	badge TEXT NOT NULL DEFAULT '',
	display_style TEXT NOT NULL DEFAULT 'banner',
	sort_order INTEGER NOT NULL DEFAULT 0,
	is_active INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE games (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	title TEXT NOT NULL DEFAULT '',
	subtitle TEXT NOT NULL DEFAULT '',
	cover_image TEXT NOT NULL DEFAULT '',
	rating TEXT NOT NULL DEFAULT '',
	badge TEXT NOT NULL DEFAULT '',
	badge_type TEXT NOT NULL DEFAULT 'good',
	hours_played INTEGER NOT NULL DEFAULT 0,
	category TEXT NOT NULL DEFAULT '',
	review_note TEXT NOT NULL DEFAULT '',
	is_featured INTEGER NOT NULL DEFAULT 0,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE media (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	title TEXT NOT NULL DEFAULT '',
	type TEXT NOT NULL DEFAULT 'anime',
	cover_image TEXT NOT NULL DEFAULT '',
	rating TEXT NOT NULL DEFAULT '',
	rank_badge TEXT NOT NULL DEFAULT '',
	category_badge TEXT NOT NULL DEFAULT '',
	progress_info TEXT NOT NULL DEFAULT '',
	review_note TEXT NOT NULL DEFAULT '',
	anilist_id INTEGER NOT NULL DEFAULT 0,
	tags TEXT NOT NULL DEFAULT '',
	is_featured INTEGER NOT NULL DEFAULT 0,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_media_type ON media(type, sort_order);

CREATE TABLE playlists (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	title TEXT NOT NULL DEFAULT '',
	subtitle TEXT NOT NULL DEFAULT '',
	type TEXT NOT NULL DEFAULT 'playlist',
	cover_image TEXT NOT NULL DEFAULT '',
	spotify_url TEXT NOT NULL DEFAULT '',
	yt_music_url TEXT NOT NULL DEFAULT '',
	audio_url TEXT NOT NULL DEFAULT '',
	duration TEXT NOT NULL DEFAULT '',
	artist TEXT NOT NULL DEFAULT '',
	is_featured INTEGER NOT NULL DEFAULT 0,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE tracks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
	track_number TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL DEFAULT '',
	artist TEXT NOT NULL DEFAULT '',
	duration TEXT NOT NULL DEFAULT '',
	audio_url TEXT NOT NULL DEFAULT '',
	sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_tracks_playlist ON tracks(playlist_id, sort_order);

CREATE TABLE admin_users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	totp_secret TEXT NOT NULL DEFAULT '',
	totp_pending TEXT NOT NULL DEFAULT '',
	totp_last_step INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE recovery_codes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username TEXT NOT NULL,
	code_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE sessions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	token_hash TEXT NOT NULL UNIQUE,
	username TEXT NOT NULL,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	last_seen TEXT NOT NULL,
	ip TEXT NOT NULL DEFAULT '',
	user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE uploads (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	file TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL DEFAULT '',
	mime TEXT NOT NULL DEFAULT '',
	size INTEGER NOT NULL DEFAULT 0,
	width INTEGER NOT NULL DEFAULT 0,
	height INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);

CREATE TABLE kv (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`
