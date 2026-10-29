// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/vynulldev/vynull/analysis"
	"github.com/vynulldev/vynull/library"
	"github.com/vynulldev/vynull/pdb"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type syncJob struct {
	JobID  string `json:"jobId"`
	Status string `json:"status"`
	Error  string `json:"error"`
	Total  int    `json:"total"`
}
type syncBatch struct {
	ID             string `json:"id"`
	Tracks         int    `json:"tracks"`
	EstimatedBytes int64  `json:"estimatedBytes"`
}
type syncManifest struct {
	Protocol      int         `json:"protocol"`
	Revision      string      `json:"revision"`
	Status        string      `json:"status"`
	Message       string      `json:"message"`
	IndexedTracks int         `json:"indexedTracks"`
	ReadyTracks   int         `json:"readyTracks"`
	Batches       []syncBatch `json:"batches"`
	Job           *syncJob    `json:"job"`
}
type batchCheckpoint struct {
	Schema   int
	DB       *pdb.Database
	Keys     map[uint32]string
	Streams  map[uint32]remoteFile
	Applied  map[string][]uint32
	Pending  map[string]string
	Revision string
}

func purgeLegacyAudio(cache string) {
	for _, pattern := range []string{"library-*", "batch-*.zip"} {
		matches, _ := filepath.Glob(filepath.Join(cache, pattern))
		for _, path := range matches {
			_ = os.RemoveAll(path)
		}
	}
	collections, _ := filepath.Glob(filepath.Join(cache, "collections", "*"))
	for _, root := range collections {
		data, err := os.ReadFile(filepath.Join(root, "collection.json"))
		if err != nil {
			_ = os.RemoveAll(root)
			continue
		}
		var header struct{ Schema int }
		if json.Unmarshal(data, &header) != nil || header.Schema != 2 {
			_ = os.RemoveAll(root)
		}
	}
}

func validDigest(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == 32 && strings.ToLower(s) == s
}
func batchRoot(cache, server string) string {
	sum := sha256.Sum256([]byte(server))
	return filepath.Join(cache, "collections", hex.EncodeToString(sum[:]))
}
func readCheckpoint(root string) (*batchCheckpoint, error) {
	f, e := os.Open(filepath.Join(root, "collection.json"))
	if e != nil {
		return nil, e
	}
	defer f.Close()
	var c batchCheckpoint
	if e = json.NewDecoder(io.LimitReader(f, 64<<20)).Decode(&c); e != nil {
		return nil, e
	}
	if c.Schema != 2 || c.DB == nil || len(c.DB.Tracks) > 65535 || c.Applied == nil || c.Pending == nil || c.Keys == nil || c.Streams == nil {
		return nil, errors.New("invalid saved collection")
	}
	seen := map[uint32]bool{}
	for _, t := range c.DB.Tracks {
		if t.ID == 0 || t.ID > 65535 || seen[t.ID] || c.Keys[t.ID] == "" {
			return nil, errors.New("invalid saved track identity")
		}
		seen[t.ID] = true
		if stream, ok := c.Streams[t.ID]; !ok || stream.Bytes < 1 || !validDigest(stream.SourceKey) || !validDigest(stream.SHA256) {
			return nil, errors.New("invalid saved stream identity")
		}
		for _, p := range []string{t.AnalyzePath} {
			if e = requireUnder(root, filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(p, "/")))); e != nil {
				return nil, e
			}
		}
	}
	c.DB.ReindexTracks()
	return &c, nil
}
func writeCheckpoint(root string, c *batchCheckpoint) error {
	if e := os.MkdirAll(root, 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(root, "checkpoint-*.tmp")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if e = f.Chmod(0600); e == nil {
		e = json.NewEncoder(f).Encode(c)
	}
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e == nil {
		e = closeErr
	}
	if e != nil {
		return e
	}
	return os.Rename(name, filepath.Join(root, "collection.json"))
}
func preparedStore(root string, db *pdb.Database) *analysis.Store {
	store := analysis.NewStoreWithCache(filepath.Join(root, "analysis-cache"))
	store.SetResidentLimit(512)
	store.SetKeep(func(uint32) bool { return true })
	for _, t := range db.Tracks {
		store.SetPath(t.ID, filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(t.FilePath, "/"))))
	}
	return store
}
func savedBundle(root string, c *batchCheckpoint) *bundle {
	c.DB.ReindexTracks()
	remote := map[string]remoteFile{}
	for _, t := range c.DB.Tracks {
		remote[filepath.Join(root, filepath.FromSlash(t.FilePath))] = c.Streams[t.ID]
	}
	return &bundle{Persistent: true, Root: root, Name: "Resonance Library", Tracks: len(c.DB.Tracks), Keys: c.Keys, DB: c.DB, Library: library.FromPDB(c.DB.Tracks, root), Analysis: preparedStore(root, c.DB), Remote: remote}
}
func (h *helper) syncBatches(ctx context.Context, client *http.Client, s *synchronization, status syncManifest) error {
	if status.Status == "checking-analysis" && status.Revision == "" {
		h.syncState(s, status.Message, nil)
		return nil
	}
	if !validDigest(status.Revision) || status.ReadyTracks < 0 || status.ReadyTracks > 65535 || len(status.Batches) > 65535 {
		return errors.New("invalid or unsupported server collection manifest")
	}
	root := batchRoot(h.Cache, s.Connection.ServerURL)
	h.operation.Lock()
	c, e := readCheckpoint(root)
	if e == nil && c.Schema != 2 {
		e = errors.New("legacy collection")
	}
	if errors.Is(e, os.ErrNotExist) {
		c = &batchCheckpoint{Schema: 2, DB: &pdb.Database{}, Keys: map[uint32]string{}, Streams: map[uint32]remoteFile{}, Applied: map[string][]uint32{}, Pending: map[string]string{}}
		e = nil
	}
	if e != nil {
		// Older collections contain complete audio copies. Streaming-only
		// Bridge intentionally discards that legacy cache before rebuilding.
		if removeErr := os.RemoveAll(root); removeErr != nil {
			h.operation.Unlock()
			return fmt.Errorf("cannot remove legacy audio cache: %w", removeErr)
		}
		c = &batchCheckpoint{Schema: 2, DB: &pdb.Database{}, Keys: map[uint32]string{}, Streams: map[uint32]remoteFile{}, Applied: map[string][]uint32{}, Pending: map[string]string{}}
	}
	h.mu.Lock()
	current := h.Sync == s
	switching := h.Session != nil && h.Library != nil && h.Library.Root != root
	restore := current && len(c.DB.Tracks) > 0 && (h.Library == nil || h.Library.Root != root) && h.Session == nil
	if restore {
		h.Library = savedBundle(root, c)
	}
	h.mu.Unlock()
	h.operation.Unlock()
	if !current {
		return context.Canceled
	}
	if switching {
		return errors.New("stop sharing before switching Resonance instances")
	}
	// An acknowledgment is sent only after the corresponding durable catalog commit.
	for batch, job := range c.Pending {
		if e = h.ackBatch(ctx, client, s.Connection, batch, job); e != nil {
			return e
		}
		delete(c.Pending, batch)
		if e = writeCheckpoint(root, c); e != nil {
			return e
		}
	}
	seen := map[string]bool{}
	var wanted *syncBatch
	complete := 0
	for i := range status.Batches {
		b := &status.Batches[i]
		if !validDigest(b.ID) || seen[b.ID] || b.Tracks < 1 || b.Tracks > 100 || b.EstimatedBytes < 1 || b.EstimatedBytes > maxBundleBytes {
			return errors.New("invalid server batch descriptor")
		}
		seen[b.ID] = true
		if _, ok := c.Applied[b.ID]; ok {
			complete++
		} else if wanted == nil {
			wanted = b
		}
	}
	if status.Status != "ready" {
		if status.Status == "waiting-analysis" && len(c.DB.Tracks) > 0 && len(status.Batches) == 0 {
			h.operation.Lock()
			e = h.reconcileBatches(root, c, map[string]bool{}, status.Revision)
			h.operation.Unlock()
			if e != nil {
				return e
			}
		}
		h.syncState(s, status.Message, nil)
		return nil
	}
	if wanted == nil {
		// Remove obsolete rows from browsing after every replacement batch is durable.
		// Immutable audio remains until a future cache cleanup so decks holding old handles are safe.
		h.operation.Lock()
		defer h.operation.Unlock()
		if e = h.reconcileBatches(root, c, seen, status.Revision); e != nil {
			return e
		}
		h.syncState(s, fmt.Sprintf("Up to date · %d fully analysed / %d indexed tracks · %d batches", status.ReadyTracks, status.IndexedTracks, complete), nil)
		return nil
	}
	h.syncState(s, fmt.Sprintf("Batch %d/%d · %d fully analysed / %d indexed tracks", complete+1, len(status.Batches), status.ReadyTracks, status.IndexedTracks), nil)
	poll, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	r, e := fetchSync(poll, client, s.Connection, "?batch="+wanted.ID)
	if e != nil {
		return e
	}
	var batchStatus syncManifest
	e = json.NewDecoder(io.LimitReader(r.Body, 16<<20)).Decode(&batchStatus)
	r.Body.Close()
	if e != nil {
		return e
	}
	if batchStatus.Job == nil {
		h.syncState(s, batchStatus.Message, nil)
		return nil
	}
	job := batchStatus.Job
	if job.Status != "completed" {
		if job.Status == "failed" || job.Status == "cancelled" {
			return fmt.Errorf("batch preparation failed: %s", redactDiagnostic(job.Error))
		}
		h.syncState(s, fmt.Sprintf("Batch %d/%d · %s", complete+1, len(status.Batches), job.Status), nil)
		return nil
	}
	if len(job.JobID) != 32 {
		return errors.New("invalid batch job identity")
	}
	if _, e = hex.DecodeString(job.JobID); e != nil {
		return e
	}
	h.Diagnostics.event("info", "batch.download", map[string]any{"batch": complete + 1, "totalBatches": len(status.Batches), "tracks": wanted.Tracks})
	download, stop := context.WithTimeout(ctx, 2*time.Hour)
	defer stop()
	r, e = fetchSync(download, client, s.Connection, "/download/"+url.PathEscape(job.JobID))
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(h.Cache, "batch-*.zip")
	if e != nil {
		r.Body.Close()
		return e
	}
	defer os.Remove(f.Name())
	n, e := io.Copy(f, io.LimitReader(r.Body, maxBundleBytes+1))
	r.Body.Close()
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	if n > maxBundleBytes {
		return errors.New("batch exceeds cache safety limit")
	}
	next, e := importBundle(f.Name(), h.Cache)
	if e != nil {
		return e
	}
	defer func() {
		if !next.Persistent {
			os.RemoveAll(next.Root)
		}
	}()
	if next.Tracks != wanted.Tracks {
		return errors.New("batch track count differs from server manifest")
	}
	h.operation.Lock()
	defer h.operation.Unlock()
	h.mu.Lock()
	current = h.Sync == s && ctx.Err() == nil
	h.mu.Unlock()
	if !current {
		return context.Canceled
	}
	if e = h.mergeBatch(root, c, next, wanted.ID, job.JobID); e != nil {
		return e
	}
	h.Diagnostics.event("info", "batch.applied", map[string]any{"batch": complete + 1, "totalBatches": len(status.Batches), "localTracks": len(c.DB.Tracks)})
	return nil
}
func (h *helper) ackBatch(ctx context.Context, client *http.Client, c connection, batch, job string) error {
	poll, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, e := http.NewRequestWithContext(poll, "POST", c.ServerURL+"/ack/"+batch+"/"+job, nil)
	if e != nil {
		return e
	}
	req.Header.Set("X-Resonance-Link-Token", c.Token)
	r, e := client.Do(req)
	if e != nil {
		return e
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return fmt.Errorf("batch saved locally; server acknowledgment returned HTTP %d", r.StatusCode)
	}
	h.Diagnostics.event("info", "batch.acknowledged", nil)
	return nil
}
func (h *helper) mergeBatch(root string, c *batchCheckpoint, next *bundle, batch, job string) error {
	if e := os.MkdirAll(filepath.Join(root, "batches"), 0700); e != nil {
		return e
	}
	// Random generation names ensure a failed commit can never overwrite a published generation.
	generation, e := os.MkdirTemp(filepath.Join(root, "batches"), "generation-")
	if e != nil {
		return e
	}
	os.Remove(generation)
	oldRoot := next.Root
	if e = os.Rename(oldRoot, generation); e != nil {
		return e
	}
	next.Root = generation
	remapped := map[string]remoteFile{}
	for path, stream := range next.Remote {
		relative, relErr := filepath.Rel(oldRoot, path)
		if relErr != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return errors.New("batch stream path escapes its generation")
		}
		remapped[filepath.Join(generation, relative)] = stream
	}
	next.Remote = remapped
	next.Persistent = true
	committed := false
	defer func() {
		if !committed {
			os.RemoveAll(generation)
		}
	}()
	keys := map[uint32]string{}
	streams := map[uint32]remoteFile{}
	stable := map[string]uint32{}
	var max uint32
	for id, key := range c.Keys {
		keys[id] = key
		streams[id] = c.Streams[id]
		stable[key] = id
		if id > max {
			max = id
		}
	}
	tracks := make([]*pdb.Track, 0, len(c.DB.Tracks)+next.Tracks)
	byID := map[uint32]*pdb.Track{}
	for _, t := range c.DB.Tracks {
		clone := *t
		byID[t.ID] = &clone
	}
	store := preparedStore(root, c.DB)
	var applied []uint32
	prefix, _ := filepath.Rel(root, generation)
	for _, t := range next.DB.Tracks {
		key := next.Keys[t.ID]
		if len(key) != 129 || key[64] != ':' || !validDigest(key[:64]) || !validDigest(key[65:]) {
			return errors.New("batch is missing a stable source identity")
		}
		id, exists := stable[key]
		if !exists {
			max++
			id = max
			stable[key] = id
		}
		if id > 65535 {
			return errors.New("player track IDs exhausted; reset the collection after stopping sharing")
		}
		clone := *t
		clone.ID = id
		clone.FilePath = filepath.ToSlash(filepath.Join(prefix, strings.TrimPrefix(t.FilePath, "/")))
		clone.AnalyzePath = filepath.ToSlash(filepath.Join(prefix, strings.TrimPrefix(t.AnalyzePath, "/")))
		clone.ArtworkID = 0
		remote, ok := next.Remote[filepath.Join(next.Root, filepath.FromSlash(t.FilePath))]
		if !ok {
			return errors.New("batch is missing its remote audio descriptor")
		}
		result := next.Analysis.Get(t.ID)
		if result == nil {
			return errors.New("verified prepared analysis is missing")
		}
		base := strings.TrimSuffix(filepath.Join(root, filepath.FromSlash(clone.AnalyzePath)), ".DAT")
		for _, suffix := range []string{".DAT", ".EXT", ".2EX"} {
			if e = rewriteAnalysisPath(base+suffix, "/"+clone.FilePath); e != nil {
				return e
			}
		}
		store.SetPath(id, filepath.Join(root, filepath.FromSlash(clone.FilePath)))
		store.Set(id, result)
		// Confirm the disk-backed prepared result is readable before publishing the checkpoint.
		check := analysis.NewStoreWithCache(filepath.Join(root, "analysis-cache"))
		check.SetKeep(func(uint32) bool { return true })
		check.SetPath(id, filepath.Join(root, filepath.FromSlash(clone.FilePath)))
		if check.Get(id) == nil {
			return errors.New("prepared analysis cache could not be saved")
		}
		keys[id] = key
		streams[id] = remote
		byID[id] = &clone
		applied = append(applied, id)
	}
	for _, t := range byID {
		tracks = append(tracks, t)
	}
	sort.Slice(tracks, func(i, j int) bool { return tracks[i].ID < tracks[j].ID })
	nextState := *c
	nextState.Keys = keys
	nextState.Streams = streams
	nextState.Applied = cloneBatchMap(c.Applied)
	nextState.Applied[batch] = applied
	nextState.Pending = map[string]string{}
	for k, v := range c.Pending {
		nextState.Pending[k] = v
	}
	nextState.Pending[batch] = job
	if e = h.commitBatchCatalog(root, &nextState, tracks); e != nil {
		return e
	}
	*c = nextState
	committed = true
	return nil
}
func cloneBatchMap(source map[string][]uint32) map[string][]uint32 {
	result := map[string][]uint32{}
	for k, v := range source {
		result[k] = v
	}
	return result
}
func (h *helper) reconcileBatches(root string, c *batchCheckpoint, wanted map[string]bool, revision string) error {
	if c.Revision == revision {
		return nil
	}
	keep := map[uint32]bool{}
	next := *c
	next.Applied = map[string][]uint32{}
	next.Keys = c.Keys
	next.Streams = map[uint32]remoteFile{}
	for batch, ids := range c.Applied {
		if wanted[batch] {
			next.Applied[batch] = ids
			for _, id := range ids {
				keep[id] = true
			}
		}
	}
	tracks := []*pdb.Track{}
	for _, t := range c.DB.Tracks {
		if keep[t.ID] {
			clone := *t
			tracks = append(tracks, &clone)
			next.Keys[t.ID] = c.Keys[t.ID]
			next.Streams[t.ID] = c.Streams[t.ID]
		}
	}
	next.Revision = revision
	if e := h.commitBatchCatalog(root, &next, tracks); e != nil {
		return e
	}
	*c = next
	return nil
}
func (h *helper) commitBatchCatalog(root string, c *batchCheckpoint, tracks []*pdb.Track) error {
	if e := os.MkdirAll(root, 0700); e != nil {
		return e
	}
	dir, e := os.MkdirTemp(root, "catalog-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(dir)
	var merge *pdb.MergeBase
	path := filepath.Join(root, "PIONEER", "rekordbox", "export.pdb")
	if _, e = os.Stat(path); e == nil {
		merge, e = pdb.LoadForMerge(path)
		if e != nil {
			return e
		}
	}
	ids := make([]uint32, len(tracks))
	for i, t := range tracks {
		ids[i] = t.ID
	}
	playlists := []*pdb.FolderNode{{ID: 1, Name: "Resonance Library", TrackIDs: ids}}
	if e = pdb.GenerateWithOptions(tracks, playlists, nil, merge, dir); e != nil {
		return e
	}
	db, e := pdb.Open(filepath.Join(dir, "PIONEER", "rekordbox", "export.pdb"))
	if e != nil {
		return e
	}
	c.DB = db
	h.mu.Lock()
	switching := h.Session != nil && (h.Library == nil || h.Library.Root != root)
	h.mu.Unlock()
	if switching {
		return errors.New("stop sharing before switching Resonance instances")
	}
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	if e = os.Rename(filepath.Join(dir, "PIONEER", "rekordbox", "export.pdb"), path); e != nil {
		return e
	}
	if e = writeCheckpoint(root, c); e != nil {
		return e
	}
	b := savedBundle(root, c)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.Session != nil {
		if h.Library == nil || h.Library.Root != root {
			return errors.New("stop sharing before switching Resonance instances")
		}
		h.Session.DB.UpdateCatalog(b.Library, b.DB, b.Analysis, pdb.BuildFolderLookup(b.DB.Tracks), preparedPlaylists(b.DB.PlaylistTree))
		h.Session.Device.SetTrackCount(uint16(b.Tracks))
	}
	h.Library = b
	return nil
}
