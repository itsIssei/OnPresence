package store

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"time"

	"onpresence/server/models"
)

func uploadURL(file string) string { return "/uploads/" + file }

func (s *Store) Uploads(ctx context.Context) ([]models.Upload, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, file, name, mime, size, width, height, created_at FROM uploads ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Upload{}
	for rows.Next() {
		var x models.Upload
		var file string
		if err := rows.Scan(&x.ID, &file, &x.Name, &x.Mime, &x.Size, &x.Width, &x.Height, &x.CreatedAt); err != nil {
			return nil, err
		}
		x.URL = uploadURL(file)
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) AddUpload(ctx context.Context, file string, x *models.Upload) error {
	x.CreatedAt = now()
	res, err := s.DB.ExecContext(ctx, `INSERT INTO uploads (file, name, mime, size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		file, x.Name, x.Mime, x.Size, x.Width, x.Height, x.CreatedAt)
	if err != nil {
		return err
	}
	x.ID, _ = res.LastInsertId()
	x.URL = uploadURL(file)
	return nil
}

// DeleteUpload removes the row and the file on disk.
func (s *Store) DeleteUpload(ctx context.Context, dir string, id int64) error {
	var file string
	err := s.DB.QueryRowContext(ctx, `DELETE FROM uploads WHERE id = ? RETURNING file`, id).Scan(&file)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	// file comes from our own random names; Base() guards anyway.
	if err := os.Remove(filepath.Join(dir, filepath.Base(file))); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// UploadInUse reports whether url is referenced by the profile or any content.
func (s *Store) UploadInUse(ctx context.Context, url string) (bool, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT
		(SELECT COUNT(*) FROM profile WHERE avatar_url = ?1 OR background_url = ?1 OR card_bg_url = ?1 OR audio_url = ?1 OR instr(settings, ?1) > 0) +
		(SELECT COUNT(*) FROM games WHERE cover_image = ?1) +
		(SELECT COUNT(*) FROM media WHERE cover_image = ?1) +
		(SELECT COUNT(*) FROM playlists WHERE cover_image = ?1 OR audio_url = ?1) +
		(SELECT COUNT(*) FROM tracks WHERE audio_url = ?1) +
		(SELECT COUNT(*) FROM referrals WHERE image_url = ?1) +
		(SELECT COUNT(*) FROM badges WHERE icon = ?1)`, url).Scan(&n)
	return n > 0, err
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

// Backup writes a consistent snapshot with VACUUM INTO and keeps the newest
// keep files in dir.
func (s *Store) Backup(ctx context.Context, dir string, keep int) (string, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "onpresence-"+time.Now().UTC().Format("20060102-150405")+".db")
	if _, err := s.DB.ExecContext(ctx, `VACUUM INTO ?`, path); err != nil {
		return "", err
	}
	matches, _ := filepath.Glob(filepath.Join(dir, "onpresence-*.db"))
	// Names sort chronologically; remove the oldest beyond keep.
	for i := 0; i < len(matches)-keep; i++ {
		os.Remove(matches[i])
	}
	return path, nil
}

// LatestBackup returns the modification time of the newest backup, or zero.
func LatestBackup(dir string) time.Time {
	matches, _ := filepath.Glob(filepath.Join(dir, "onpresence-*.db"))
	var latest time.Time
	for _, m := range matches {
		if fi, err := os.Stat(m); err == nil && fi.ModTime().After(latest) {
			latest = fi.ModTime()
		}
	}
	return latest
}
