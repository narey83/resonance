// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/json"
	"github.com/vynulldev/vynull/dbclient"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestConnectionValidation(t *testing.T) {
	for _, u := range []string{"file:///etc/passwd", "http://example.com/api/v0/analysis/pioneer-link/sync", "https://user:pass@example.com/api/v0/analysis/pioneer-link/sync"} {
		if validateConnection(connection{1, u, strings.Repeat("a", 64), time.Now().Add(time.Hour)}) == nil {
			t.Fatal(u)
		}
	}
}
func TestLiveCatalogPreservesPlayerSession(t *testing.T) {
	archive := os.Getenv("RESONANCE_TEST_BUNDLE_ZIP")
	root := os.Getenv("RESONANCE_TEST_EXPORT_ROOT")
	if archive == "" || root == "" {
		t.Skip()
	}
	cache := t.TempDir()
	old, e := importBundle(archive, cache)
	if e != nil {
		t.Fatal(e)
	}
	d, _ := os.ReadFile(filepath.Join(root, "export-manifest.json"))
	var m exportManifest
	json.Unmarshal(d, &m)
	// Copy fixture before publication, since install moves the incoming private generation.
	incoming := filepath.Join(t.TempDir(), "snapshot")
	if e = copyFixture(root, incoming); e != nil {
		t.Fatal(e)
	}
	next, e := loadBundle(incoming, m)
	if e != nil {
		t.Fatal(e)
	}
	var a adapter
	for _, v := range adapters(true) {
		if v.IP == "127.0.0.1" {
			a = v
		}
	}
	h := &helper{Library: old, Cache: cache, AllowLoopback: true}
	if e = h.start(a.Name, a.IP); e != nil {
		t.Fatal(e)
	}
	defer h.stop()
	c, e := dbclient.Dial(net.ParseIP(a.IP), int(h.Session.DB.QueryPort()), 1)
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	original := old.DB.Tracks[0]
	path := old.Library.Track(original.ID).FilePath
	info, _ := os.Stat(path)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 30; i++ {
			meta, err := c.FetchMetadata(dbclient.SlotRekordbox, original.ID)
			if err != nil || meta.Title != original.Title {
				t.Errorf("existing session changed: %v", err)
				return
			}
		}
	}()
	if e = h.install(next); e != nil {
		t.Fatal(e)
	}
	wg.Wait()
	if h.Library.Tracks != 15 {
		t.Fatal(h.Library.Tracks)
	}
	if _, e = os.Stat(path); e != nil {
		t.Fatal("old audio removed", e)
	}
	now, _ := os.Stat(path)
	if now.Size() != info.Size() {
		t.Fatal("old audio changed")
	}
	for _, track := range h.Library.DB.Tracks {
		meta, e := c.FetchMetadata(dbclient.SlotRekordbox, track.ID)
		if e != nil || meta.Title != track.Title {
			t.Fatalf("new track inaccessible %d %v", track.ID, e)
		}
	}
	t.Log("1 to 15 tracks published while the same player TCP session remained connected; old audio path retained")
}
func copyFixture(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, e error) error {
		if e != nil {
			return e
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		return os.Link(path, target)
	})
}
func TestAutomaticSyncAndFailureKeepsLibrary(t *testing.T) {
	archive := os.Getenv("RESONANCE_TEST_BUNDLE_ZIP")
	if archive == "" {
		t.Skip()
	}
	revision := "one"
	bad := false
	downloads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Resonance-Link-Token") != strings.Repeat("a", 64) {
			w.WriteHeader(401)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/download/job") {
			downloads++
			if bad {
				w.Write([]byte("broken"))
				return
			}
			http.ServeFile(w, r, archive)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"revision": revision, "job": map[string]any{"jobId": "job", "status": "completed", "total": 1}})
	}))
	defer server.Close()
	c := connection{1, server.URL + "/api/v0/analysis/pioneer-link/sync", strings.Repeat("a", 64), time.Now().Add(time.Hour)}
	s := &synchronization{Connection: c}
	h := &helper{Cache: t.TempDir(), Sync: s}
	client := server.Client()
	if e := h.syncOnce(context.Background(), client, s); e != nil {
		t.Fatal(e)
	}
	old := h.Library
	if e := h.syncOnce(context.Background(), client, s); e != nil {
		t.Fatal(e)
	}
	if downloads != 1 {
		t.Fatal("unchanged revision redownloaded")
	}
	revision = "two"
	if e := h.syncOnce(context.Background(), client, s); e != nil {
		t.Fatal(e)
	}
	if s.Revision != "two" || downloads != 2 {
		t.Fatal("changed revision did not update automatically")
	}
	old = h.Library
	revision = "three"
	bad = true
	if e := h.syncOnce(context.Background(), client, s); e == nil {
		t.Fatal("corrupt update accepted")
	}
	if h.Library != old || s.Revision != "two" {
		t.Fatal("last working library lost")
	}
}
