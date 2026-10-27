// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"github.com/vynulldev/vynull/analysis"
	"github.com/vynulldev/vynull/pdb"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testPreparedBatch(t *testing.T, cache, key, title string) *bundle {
	t.Helper()
	root, e := os.MkdirTemp(cache, "incoming-")
	if e != nil {
		t.Fatal(e)
	}
	for _, dir := range []string{"Contents", "PIONEER"} {
		if e = os.MkdirAll(filepath.Join(root, dir), 0700); e != nil {
			t.Fatal(e)
		}
	}
	if e = os.WriteFile(filepath.Join(root, "Contents", "track.wav"), []byte("prepared-audio"), 0600); e != nil {
		t.Fatal(e)
	}
	data := make([]byte, 30)
	copy(data, "PMAI")
	binary.BigEndian.PutUint32(data[4:8], 12)
	binary.BigEndian.PutUint32(data[8:12], 30)
	copy(data[12:], "PPTH")
	binary.BigEndian.PutUint32(data[16:20], 16)
	binary.BigEndian.PutUint32(data[20:24], 18)
	binary.BigEndian.PutUint32(data[24:28], 2)
	for _, ext := range []string{".DAT", ".EXT", ".2EX"} {
		if e = os.WriteFile(filepath.Join(root, "PIONEER", "track"+ext), data, 0600); e != nil {
			t.Fatal(e)
		}
	}
	db := &pdb.Database{Tracks: []*pdb.Track{{ID: 1, Title: title, Artist: "Artist", FilePath: "/Contents/track.wav", AnalyzePath: "/PIONEER/track.DAT", Tempo: 12000, Duration: 60}}}
	db.ReindexTracks()
	store := analysis.NewStore()
	store.Set(1, &analysis.Result{Imported: true, BPM: 120, Beats: []float64{0, 500}, WavePreview: []byte{1, 2}})
	return &bundle{Root: root, Tracks: 1, Keys: map[uint32]string{1: key}, DB: db, Analysis: store}
}
func TestBatchMergeResumesWithStableIdentities(t *testing.T) {
	cache := t.TempDir()
	root := batchRoot(cache, "https://resonance.test/api/v0/bridge/sync")
	h := &helper{Cache: cache}
	c := &batchCheckpoint{Schema: 1, DB: &pdb.Database{}, Keys: map[uint32]string{}, Applied: map[string][]uint32{}, Pending: map[string]string{}}
	k1 := strings.Repeat("a", 64) + ":" + strings.Repeat("b", 64)
	k2 := strings.Repeat("c", 64) + ":" + strings.Repeat("d", 64)
	b1 := strings.Repeat("1", 64)
	b2 := strings.Repeat("2", 64)
	if e := h.mergeBatch(root, c, testPreparedBatch(t, cache, k1, "First"), b1, strings.Repeat("a", 32)); e != nil {
		t.Fatal(e)
	}
	first := c.Applied[b1][0]
	if e := h.mergeBatch(root, c, testPreparedBatch(t, cache, k2, "Second"), b2, strings.Repeat("b", 32)); e != nil {
		t.Fatal(e)
	}
	resumed, e := readCheckpoint(root)
	if e != nil {
		t.Fatal(e)
	}
	if len(resumed.DB.Tracks) != 2 || resumed.Keys[first] != k1 || len(resumed.Pending) != 2 {
		t.Fatal("collection did not resume")
	}
	restored := savedBundle(root, resumed)
	if restored.Analysis.Get(first) == nil || !restored.Persistent {
		t.Fatal("prepared analysis did not resume")
	}
	// An unchanged source gets its original ID, including after restarting the app.
	if e = h.mergeBatch(root, resumed, testPreparedBatch(t, cache, k1, "First updated"), b1, strings.Repeat("c", 32)); e != nil {
		t.Fatal(e)
	}
	if resumed.Applied[b1][0] != first || len(resumed.DB.Tracks) != 2 {
		t.Fatal("source identity was not stable")
	}
	if e = h.reconcileBatches(root, resumed, map[string]bool{b2: true}, strings.Repeat("f", 64)); e != nil {
		t.Fatal(e)
	}
	if len(resumed.DB.Tracks) != 1 || resumed.DB.Tracks[0].Title != "Second" {
		t.Fatal("obsolete batch still browsable")
	}
	if _, e = os.Stat(restored.Library.Track(first).FilePath); e != nil {
		t.Fatal("existing player file removed", e)
	}
}
func TestBatchRejectsMissingIdentityWithoutPublishing(t *testing.T) {
	cache := t.TempDir()
	root := batchRoot(cache, "https://server.test")
	h := &helper{Cache: cache}
	c := &batchCheckpoint{Schema: 1, DB: &pdb.Database{}, Keys: map[uint32]string{}, Applied: map[string][]uint32{}, Pending: map[string]string{}}
	if e := h.mergeBatch(root, c, testPreparedBatch(t, cache, "legacy-hash:1", "Bad"), strings.Repeat("a", 64), strings.Repeat("b", 32)); e == nil {
		t.Fatal("missing source identity accepted")
	}
	if _, e := os.Stat(filepath.Join(root, "collection.json")); !os.IsNotExist(e) {
		t.Fatal("failed batch published")
	}
}
func TestBatchWaitingAnalysisIsConnectedAndDoesNotDownload(t *testing.T) {
	cache := t.TempDir()
	h := &helper{Cache: cache}
	s := &synchronization{Connection: connection{ServerURL: "https://server.test/api/v0/bridge/sync"}}
	h.Sync = s
	status := syncManifest{Protocol: 2, Revision: strings.Repeat("a", 64), Status: "waiting-analysis", Message: "Connected. No fully analysed tracks are ready.", IndexedTracks: 59389}
	if e := h.syncBatches(context.Background(), &http.Client{}, s, status); e != nil {
		t.Fatal(e)
	}
	if s.Status != status.Message || s.Error != "" {
		t.Fatal(s.Status, s.Error)
	}
}
func TestBatchAcknowledgmentUsesPostAndCredentialHeader(t *testing.T) {
	secret := strings.Repeat("a", 64)
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.Method != "POST" || r.Header.Get("X-Resonance-Link-Token") != secret {
			t.Error("invalid acknowledgment")
		}
		w.WriteHeader(200)
	}))
	defer server.Close()
	h := &helper{}
	if e := h.ackBatch(context.Background(), server.Client(), connection{ServerURL: server.URL, Token: secret}, strings.Repeat("b", 64), strings.Repeat("c", 32)); e != nil {
		t.Fatal(e)
	}
	if !called {
		t.Fatal("ack not sent")
	}
}
func TestReadableSyncFailureIsRedacted(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
		json.NewEncoder(w).Encode(map[string]string{"error": "Worker unavailable; token=private-value"})
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, e := fetchSync(ctx, server.Client(), connection{ServerURL: server.URL}, "")
	if e == nil || !strings.Contains(e.Error(), "Worker unavailable") || strings.Contains(e.Error(), "private-value") {
		t.Fatal(e)
	}
}
