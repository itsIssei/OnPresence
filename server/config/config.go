// Package config loads runtime settings from environment variables.
package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port      string
	DataDir   string // holds the DB, uploads/, catalog/, backups/
	DBPath    string
	WebDir    string // built frontend (dist). Empty = embedded build.
	PublicURL string // e.g. https://example.com, used for canonical/OG tags

	AdminUser     string
	AdminPassword string
	AdminReset    bool

	TrustedProxies []*net.IPNet
	SessionTTL     time.Duration
	BackupKeep     int // nightly DB snapshots to keep; 0 disables backups
	Dev            bool
	Version        string // build version, set by main
}

func (c Config) UploadsDir() string { return filepath.Join(c.DataDir, "uploads") }
func (c Config) CatalogDir() string { return filepath.Join(c.DataDir, "catalog") }
func (c Config) BackupDir() string  { return filepath.Join(c.DataDir, "backups") }

// Load reads the environment. It returns an error for invalid values.
func Load() (Config, error) {
	c := Config{
		Port:          env("PORT", "8080"),
		DataDir:       env("DATA_DIR", ""),
		DBPath:        env("DB_PATH", ""),
		WebDir:        env("WEB_DIR", ""),
		PublicURL:     strings.TrimRight(env("PUBLIC_URL", ""), "/"),
		AdminUser:     env("ADMIN_USERNAME", "admin"),
		AdminPassword: os.Getenv("ADMIN_PASSWORD"),
		AdminReset:    os.Getenv("ADMIN_RESET_PASSWORD") == "1",
		Dev:           os.Getenv("DEV") == "1",
	}

	// DATA_DIR wins; otherwise derive it from DB_PATH; otherwise ./data.
	switch {
	case c.DataDir == "" && c.DBPath != "":
		c.DataDir = filepath.Dir(c.DBPath)
	case c.DataDir == "":
		c.DataDir = "./data"
	}
	if c.DBPath == "" {
		c.DBPath = filepath.Join(c.DataDir, "onpresence.db")
	}

	nets, err := ParseCIDRs(os.Getenv("TRUSTED_PROXIES"))
	if err != nil {
		return c, err
	}
	c.TrustedProxies = nets

	ttl, err := time.ParseDuration(env("SESSION_TTL", "168h"))
	if err != nil || ttl < time.Hour {
		return c, fmt.Errorf("SESSION_TTL must be a duration >= 1h")
	}
	c.SessionTTL = ttl

	keep, err := strconv.Atoi(env("BACKUP_KEEP", "7"))
	if err != nil || keep < 0 {
		return c, fmt.Errorf("BACKUP_KEEP must be a non-negative integer")
	}
	c.BackupKeep = keep

	return c, nil
}

// ParseCIDRs parses a comma-separated list of CIDRs or bare IPs.
func ParseCIDRs(list string) ([]*net.IPNet, error) {
	var out []*net.IPNet
	for _, c := range strings.Split(list, ",") {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if !strings.Contains(c, "/") {
			if strings.Contains(c, ":") {
				c += "/128"
			} else {
				c += "/32"
			}
		}
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			return nil, fmt.Errorf("TRUSTED_PROXIES: invalid entry %q", c)
		}
		out = append(out, n)
	}
	return out, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
