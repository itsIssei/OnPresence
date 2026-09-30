// Package onpresence embeds the built frontend (web/dist) into the server binary.
package onpresence

import (
	"embed"
	"io/fs"
)

//go:embed all:web/dist
var dist embed.FS

// Web returns the built frontend file system rooted at web/dist.
func Web() fs.FS {
	sub, err := fs.Sub(dist, "web/dist")
	if err != nil {
		panic(err)
	}
	return sub
}
