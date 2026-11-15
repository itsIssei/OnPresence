package store

import (
	"context"
	"database/sql"
	"encoding/json"

	"onpresence/server/models"
)

const caseItemCols = `id, case_id, title, subtitle, image, rating, status, tags, note, link, size, is_featured, sort_order, created_at`

func scanCaseItem(rows *sql.Rows) (models.CaseItem, error) {
	var x models.CaseItem
	err := rows.Scan(&x.ID, &x.CaseID, &x.Title, &x.Subtitle, &x.Image, &x.Rating, &x.Status, &x.Tags, &x.Note, &x.Link, &x.Size, &x.IsFeatured, &x.SortOrder, &x.CreatedAt)
	return x, err
}

// Cases returns every case with its items.
func (s *Store) Cases(ctx context.Context) ([]models.Case, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, name, icon, layout, aspect, sort_order, created_at FROM cases ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	out := []models.Case{}
	index := map[int64]int{}
	for rows.Next() {
		var x models.Case
		if err := rows.Scan(&x.ID, &x.Name, &x.Icon, &x.Layout, &x.Aspect, &x.SortOrder, &x.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		x.Items = []models.CaseItem{}
		index[x.ID] = len(out)
		out = append(out, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items, err := s.CaseItems(ctx)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		if i, ok := index[it.CaseID]; ok {
			out[i].Items = append(out[i].Items, it)
		}
	}
	return out, nil
}

// CaseItems returns all case items, in display order within each case.
func (s *Store) CaseItems(ctx context.Context) ([]models.CaseItem, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT `+caseItemCols+` FROM case_items ORDER BY case_id, is_featured DESC, sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.CaseItem{}
	for rows.Next() {
		x, err := scanCaseItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// CaseIDs returns the ids of all cases.
func (s *Store) CaseIDs(ctx context.Context) (map[int64]bool, error) {
	return caseIDs(ctx, s.DB)
}

type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func caseIDs(ctx context.Context, q querier) (map[int64]bool, error) {
	rows, err := q.QueryContext(ctx, `SELECT id FROM cases`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// CaseExists reports whether a case with this id exists.
func (s *Store) CaseExists(ctx context.Context, id int64) (bool, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM cases WHERE id = ?`, id).Scan(&n)
	return n > 0, err
}

// SaveCase upserts a case. Its items are not touched.
func (s *Store) SaveCase(ctx context.Context, x *models.Case) error {
	if x.ID == 0 {
		x.CreatedAt = now()
	}
	id, err := s.upsert(ctx, x.ID,
		`UPDATE cases SET name=?, icon=?, layout=?, aspect=?, sort_order=? WHERE id=?`,
		`INSERT INTO cases (name, icon, layout, aspect, sort_order, created_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
		x.Name, x.Icon, x.Layout, x.Aspect, x.SortOrder)
	x.ID = id
	return err
}

// SaveCaseItem upserts a case item. The case must exist.
func (s *Store) SaveCaseItem(ctx context.Context, x *models.CaseItem) error {
	if x.ID == 0 {
		x.CreatedAt = now()
	}
	id, err := s.upsert(ctx, x.ID,
		`UPDATE case_items SET case_id=?, title=?, subtitle=?, image=?, rating=?, status=?, tags=?, note=?, link=?, size=?, is_featured=?, sort_order=? WHERE id=?`,
		`INSERT INTO case_items (case_id, title, subtitle, image, rating, status, tags, note, link, size, is_featured, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
		x.CaseID, x.Title, x.Subtitle, x.Image, x.Rating, x.Status, x.Tags, x.Note, x.Link, x.Size, b2i(x.IsFeatured), x.SortOrder)
	x.ID = id
	return err
}

// deleteCase removes a case, its items and its "case:<id>" Sections entry.
func (s *Store) deleteCase(ctx context.Context, id int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM case_items WHERE case_id = ?`, id); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM cases WHERE id = ?`, id)
		if err != nil {
			return err
		}
		if err := mustAffect(res); err != nil {
			return err
		}
		var raw string
		if err := tx.QueryRowContext(ctx, `SELECT settings FROM profile WHERE id = 1`).Scan(&raw); err != nil {
			if err == sql.ErrNoRows {
				return nil
			}
			return err
		}
		st := decodeSettings(raw)
		st.PruneCases(func(c int64) bool { return c != id })
		b, err := json.Marshal(st)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE profile SET settings = ? WHERE id = 1`, string(b))
		return err
	})
}
