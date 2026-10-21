// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/vynulldev/vynull/analysis"
	"github.com/vynulldev/vynull/library"
	"github.com/vynulldev/vynull/pdb"
)

const maxBundleBytes int64 = 50 << 30

type fileSpec struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}
type exportManifest struct {
	SchemaVersion int        `json:"schemaVersion"`
	Profile       string     `json:"profile"`
	TrackCount    int        `json:"trackCount"`
	PlaylistName  string     `json:"playlistName"`
	Files         []fileSpec `json:"files"`
}
type bundle struct {
	Keys     map[uint32]string `json:"-"`
	Root     string            `json:"-"`
	Name     string            `json:"name"`
	Tracks   int               `json:"tracks"`
	DB       *pdb.Database     `json:"-"`
	Library  *library.Library  `json:"-"`
	Analysis *analysis.Store   `json:"-"`
}

func safeName(name string) (string, error) {
	if strings.ContainsAny(name, "\\:\x00") || strings.HasPrefix(name, "/") {
		return "", errors.New("unsafe bundle filename")
	}
	clean := strings.TrimSuffix(name, "/")
	parts := strings.Split(clean, "/")
	if len(parts) == 0 || (parts[0] != "Contents" && parts[0] != "PIONEER" && clean != "export-manifest.json") {
		return "", errors.New("unexpected bundle file")
	}
	for _, p := range parts {
		low := strings.ToLower(strings.Split(p, ".")[0])
		if p == "" || p == "." || p == ".." || strings.TrimRight(p, " .") != p || low == "con" || low == "prn" || low == "aux" || low == "nul" || (len(low) == 4 && (strings.HasPrefix(low, "com") || strings.HasPrefix(low, "lpt")) && low[3] >= '1' && low[3] <= '9') {
			return "", errors.New("unsafe bundle path")
		}
	}
	return clean, nil
}
func requireUnder(root, path string) error {
	rr, e := filepath.EvalSymlinks(root)
	if e != nil {
		return e
	}
	rp, e := filepath.EvalSymlinks(path)
	if e != nil {
		return e
	}
	rel, e := filepath.Rel(rr, rp)
	if e != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return errors.New("bundle path escapes its directory")
	}
	return nil
}
func importBundle(archive, cache string) (*bundle, error) {
	z, e := zip.OpenReader(archive)
	if e != nil {
		return nil, e
	}
	defer z.Close()
	if len(z.File) > 100000 {
		return nil, errors.New("bundle has too many files")
	}
	entries := map[string]*zip.File{}
	folded := map[string]bool{}
	var total uint64
	for _, f := range z.File {
		n, e := safeName(f.Name)
		if e != nil {
			return nil, e
		}
		if f.Mode()&os.ModeSymlink != 0 || (!f.Mode().IsRegular() && !f.FileInfo().IsDir()) {
			return nil, errors.New("links and special files are not allowed")
		}
		if folded[strings.ToLower(n)] {
			return nil, errors.New("duplicate bundle path")
		}
		folded[strings.ToLower(n)] = true
		if f.FileInfo().IsDir() {
			continue
		}
		if f.UncompressedSize64 > uint64(maxBundleBytes)-total {
			return nil, errors.New("bundle is too large")
		}
		total += f.UncompressedSize64
		entries[n] = f
	}
	mf := entries["export-manifest.json"]
	if mf == nil || mf.UncompressedSize64 > 16<<20 {
		return nil, errors.New("missing or oversized export manifest")
	}
	mr, e := mf.Open()
	if e != nil {
		return nil, e
	}
	var m exportManifest
	e = json.NewDecoder(io.LimitReader(mr, 16<<20)).Decode(&m)
	mr.Close()
	if e != nil {
		return nil, e
	}
	if m.SchemaVersion != 1 || m.TrackCount < 1 || m.TrackCount > 65535 || m.PlaylistName == "" {
		return nil, errors.New("unsupported export manifest")
	}
	expected := map[string]fileSpec{}
	for _, s := range m.Files {
		n, e := safeName(s.Path)
		digest, de := hex.DecodeString(s.SHA256)
		if e != nil || n == "export-manifest.json" || s.Bytes < 0 || len(digest) != 32 || de != nil || strings.ToLower(s.SHA256) != s.SHA256 {
			return nil, errors.New("invalid file manifest")
		}
		if _, ok := expected[n]; ok {
			return nil, errors.New("duplicate manifest entry")
		}
		f := entries[n]
		if f == nil || uint64(s.Bytes) != f.UncompressedSize64 {
			return nil, errors.New("bundle file inventory differs from manifest")
		}
		expected[n] = s
	}
	if len(expected)+1 != len(entries) {
		return nil, errors.New("manifest must cover every bundle file")
	}
	if entries["PIONEER/rekordbox/export.pdb"] == nil {
		return nil, errors.New("prepare a dual or legacy export; classic Pioneer database is required for Network Link")
	}
	root, e := os.MkdirTemp(cache, "library-")
	if e != nil {
		return nil, e
	}
	ok := false
	defer func() {
		if !ok {
			os.RemoveAll(root)
		}
	}()
	for n, f := range entries {
		out := filepath.Join(root, filepath.FromSlash(n))
		if e = os.MkdirAll(filepath.Dir(out), 0700); e != nil {
			return nil, e
		}
		r, e := f.Open()
		if e != nil {
			return nil, e
		}
		w, e := os.OpenFile(out, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			r.Close()
			return nil, e
		}
		h := sha256.New()
		written, copyErr := io.Copy(io.MultiWriter(w, h), io.LimitReader(r, int64(f.UncompressedSize64)+1))
		r.Close()
		closeErr := w.Close()
		if copyErr != nil || closeErr != nil || written != int64(f.UncompressedSize64) {
			return nil, errors.New("bundle extraction failed")
		}
		if spec, exists := expected[n]; exists && hex.EncodeToString(h.Sum(nil)) != spec.SHA256 {
			return nil, fmt.Errorf("checksum mismatch: %s", n)
		}
	}
	b, e := loadBundle(root, m)
	if e != nil {
		return nil, e
	}
	ok = true
	return b, nil
}
func loadBundle(root string, m exportManifest) (*bundle, error) {
	db, e := pdb.Open(filepath.Join(root, "PIONEER", "rekordbox", "export.pdb"))
	if e != nil {
		return nil, e
	}
	if len(db.Tracks) != m.TrackCount {
		return nil, errors.New("Pioneer database track count differs from manifest")
	}
	hashes := map[string]string{}
	for _, f := range m.Files {
		hashes[f.Path] = f.SHA256
	}
	keys := map[uint32]string{}
	occurrences := map[string]int{}
	for _, t := range db.Tracks {
		hash := hashes[strings.TrimPrefix(t.FilePath, "/")]
		if hash == "" {
			return nil, errors.New("audio missing from manifest")
		}
		occurrences[hash]++
		keys[t.ID] = fmt.Sprintf("%s:%d", hash, occurrences[hash])
	}
	lib := library.FromPDB(db.Tracks, root)
	store := analysis.NewStore()
	store.SetKeep(func(uint32) bool { return true })
	for _, t := range lib.Tracks() {
		if e := requireUnder(root, t.FilePath); e != nil {
			return nil, e
		}
		info, e := os.Stat(t.FilePath)
		if e != nil || !info.Mode().IsRegular() {
			return nil, errors.New("audio file missing")
		}
		p := db.TrackByID(t.ID)
		dat := filepath.Join(root, filepath.FromSlash(p.AnalyzePath))
		if e := requireUnder(root, dat); e != nil {
			return nil, e
		}
		base := strings.TrimSuffix(dat, filepath.Ext(dat))
		for _, suffix := range []string{".EXT", ".2EX"} {
			if e := requireUnder(root, base+suffix); e != nil {
				return nil, e
			}
		}
		result := analysis.ParseANLZ(dat, base+".EXT", base+".2EX", t.BPM, int(t.Duration.Seconds()))
		if result == nil {
			return nil, errors.New("prepared track analysis is unreadable")
		}
		store.Set(t.ID, result)
	}
	return &bundle{Keys: keys, Root: root, Name: m.PlaylistName, Tracks: len(db.Tracks), DB: db, Library: lib, Analysis: store}, nil
}
