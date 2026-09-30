// Command server runs OnPresence: JSON API, admin panel and the built frontend.
package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	onpresence "onpresence"
	"onpresence/server/api"
	"onpresence/server/config"
	"onpresence/server/store"
)

// version is set at build time: -ldflags "-X main.version=v1.2.3".
var version = "dev"

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "-v" || os.Args[1] == "--version" || os.Args[1] == "version") {
		fmt.Println("onpresence", version)
		return
	}
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cfg.Version = version
	var logHandler slog.Handler = slog.NewJSONHandler(os.Stdout, nil)
	if cfg.Dev {
		logHandler = slog.NewTextHandler(os.Stdout, nil)
	}
	slog.SetDefault(slog.New(logHandler))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	for _, d := range []string{cfg.DataDir, cfg.UploadsDir()} {
		if err := os.MkdirAll(d, 0o750); err != nil {
			return err
		}
	}

	st, err := store.Open(ctx, cfg.DBPath)
	if err != nil {
		return err
	}
	defer st.Close()
	if err := st.BootstrapAdmin(ctx, cfg.AdminUser, cfg.AdminPassword, cfg.AdminReset); err != nil {
		return err
	}

	var web fs.FS = onpresence.Web()
	if cfg.WebDir != "" {
		web = os.DirFS(cfg.WebDir)
	}
	if _, err := fs.Stat(web, "index.html"); err != nil {
		slog.Warn("frontend build not found; run `npm run build` in web/ (API still works)")
	}

	srv, err := api.New(cfg, st, web)
	if err != nil {
		return err
	}
	go housekeeping(ctx, cfg, st, srv)

	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute, // large uploads on slow links
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "version", version, "addr", httpSrv.Addr, "admin", "/admin", "data", cfg.DataDir)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpSrv.Shutdown(shutdownCtx)
}

// housekeeping purges expired sessions and takes a daily DB backup.
func housekeeping(ctx context.Context, cfg config.Config, st *store.Store, srv *api.Server) {
	tick := time.NewTicker(15 * time.Minute)
	defer tick.Stop()
	for {
		st.PurgeExpiredSessions(ctx)
		srv.Sweep()
		if cfg.BackupKeep > 0 && time.Since(store.LatestBackup(cfg.BackupDir())) > 24*time.Hour {
			if path, err := st.Backup(ctx, cfg.BackupDir(), cfg.BackupKeep); err != nil {
				slog.Error("backup failed", "err", err)
			} else {
				slog.Info("backup written", "path", path)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
