// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"errors"
	"github.com/vynulldev/vynull/analysis"
	"github.com/vynulldev/vynull/library"
	"github.com/vynulldev/vynull/pdb"
	"os"
	"path/filepath"
	"strings"
)

// install retains immutable files and stable player IDs while clients remain connected.
// Called under operation; old generations are retained until the helper exits.
func (h *helper) install(next *bundle) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	old := h.Library
	if old == nil {
		h.Library = next
		return nil
	}
	if h.Session == nil {
		h.Library = next
		os.RemoveAll(old.Root)
		return nil
	}
	stable := map[string]uint32{}
	var max uint32
	for id, key := range old.Keys {
		stable[key] = id
		if id > max {
			max = id
		}
	}
	ids := map[uint32]uint32{}
	keys := map[uint32]string{}
	store := analysis.NewStore()
	store.SetKeep(func(uint32) bool { return true })
	for _, t := range next.DB.Tracks {
		id, ok := stable[next.Keys[t.ID]]
		if !ok {
			max++
			id = max
		}
		if id > 65535 {
			return errors.New("player track ID space exhausted; stop and restart sharing")
		}
		ids[t.ID] = id
		keys[id] = next.Keys[t.ID]
		store.Set(id, next.Analysis.Get(t.ID))
	}
	dir := filepath.Join(old.Root, "generations", filepath.Base(next.Root))
	if e := os.MkdirAll(filepath.Dir(dir), 0700); e != nil {
		return e
	}
	if e := os.Rename(next.Root, dir); e != nil {
		return e
	}
	prefix, _ := filepath.Rel(old.Root, dir)
	current := map[uint32]bool{}
	for _, t := range next.DB.Tracks {
		t.ID = ids[t.ID]
		current[t.ID] = true
		t.FilePath = filepath.ToSlash(filepath.Join(prefix, strings.TrimPrefix(t.FilePath, "/")))
		t.AnalyzePath = filepath.ToSlash(filepath.Join(prefix, strings.TrimPrefix(t.AnalyzePath, "/")))
		if previous := old.DB.TrackByID(t.ID); previous != nil && old.Keys[t.ID] == keys[t.ID] {
			duplicate := filepath.Join(old.Root, filepath.FromSlash(t.FilePath))
			t.FilePath = previous.FilePath
			os.Remove(duplicate)
		}
		base := strings.TrimSuffix(filepath.Join(old.Root, filepath.FromSlash(t.AnalyzePath)), ".DAT")
		for _, suffix := range []string{".DAT", ".EXT", ".2EX"} {
			if e := rewriteAnalysisPath(base+suffix, "/"+strings.TrimPrefix(t.FilePath, "/")); e != nil {
				os.RemoveAll(dir)
				return e
			}
		}

	}
	for _, p := range next.DB.PlaylistTree {
		for i, id := range p.TrackIDs {
			p.TrackIDs[i] = ids[id]
		}
	}
	// Retain removed/replaced tracks for a deck that still holds an old ID or file handle.
	for _, t := range old.DB.Tracks {
		if !current[t.ID] {
			next.DB.Tracks = append(next.DB.Tracks, t)
			keys[t.ID] = old.Keys[t.ID]
			store.Set(t.ID, old.Analysis.Get(t.ID))
		}
	}
	next.DB.ReindexTracks()
	next.Root = old.Root
	next.Keys = keys
	next.Analysis = store
	next.Library = library.FromPDB(next.DB.Tracks, old.Root)
	h.Session.DB.UpdateCatalog(next.Library, next.DB, store, pdb.BuildFolderLookup(next.DB.Tracks), preparedPlaylists(next.DB.PlaylistTree))
	h.Session.Device.SetTrackCount(uint16(next.Tracks))
	h.Library = next
	return nil
}
