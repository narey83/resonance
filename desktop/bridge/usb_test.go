// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func usbFixture(t *testing.T) *bundle {
	t.Helper()
	archive := os.Getenv("RESONANCE_TEST_BUNDLE_ZIP")
	if archive == "" {
		t.Skip("set real bundle fixture")
	}
	b, e := importBundle(archive, t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestUSBWriteAndReadback(t *testing.T) {
	b := usbFixture(t)
	target, _ := filepath.EvalSymlinks(t.TempDir())
	if e := writeUSB(context.Background(), b, target, nil, nil); e != nil {
		t.Fatal(e)
	}
	data, _ := os.ReadFile(filepath.Join(target, "export-manifest.json"))
	var m exportManifest
	json.Unmarshal(data, &m)
	for _, spec := range m.Files {
		p := filepath.Join(target, filepath.FromSlash(spec.Path))
		data, e := os.ReadFile(p)
		if e != nil {
			t.Fatal(e)
		}
		hash := sha256.Sum256(data)
		if hex.EncodeToString(hash[:]) != spec.SHA256 {
			t.Fatal("readback mismatch", spec.Path)
		}
	}
	if e := writeUSB(context.Background(), b, target, nil, nil); e == nil {
		t.Fatal("existing export replaced")
	}
	t.Log("isolated folder: export written and every file checksum verified")
}
func TestUSBRefusesExistingFiles(t *testing.T) {
	p, _ := filepath.EvalSymlinks(t.TempDir())
	os.WriteFile(filepath.Join(p, "keep.txt"), []byte("keep"), 0600)
	if destinationReady(p) == nil {
		t.Fatal("nonempty destination accepted")
	}
	root := t.TempDir()
	os.Symlink(p, filepath.Join(root, "link"))
	if destinationReady(filepath.Join(root, "link")) == nil {
		t.Fatal("symlink accepted")
	}
}

func TestUSBJobActionsReleaseOnlyAfterServerAccepts(t *testing.T) {
	accepted := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Resonance-Link-Token") != strings.Repeat("a", 64) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if !accepted {
			w.WriteHeader(http.StatusConflict)
			return
		}
		if r.Method != "POST" || (r.URL.Path != "/export/defer" && r.URL.Path != "/export/cancel") {
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer server.Close()
	for _, action := range []string{"defer", "cancel"} {
		u := &usbTransfer{Status: "ready", Export: &usbPrepared{}, Connection: connection{ServerURL: server.URL + "/export", Token: strings.Repeat("a", 64)}}
		h := &helper{USB: u}
		accepted = false
		if err := h.changeUSBJob(u, action); err == nil || h.USB != u {
			t.Fatal("rejected action discarded the export", action)
		}
		accepted = true
		if err := h.changeUSBJob(u, action); err != nil || h.USB != nil {
			t.Fatal("accepted action did not release the export", action, err)
		}
	}
}

func TestUSBWatcherReleasesDeferredServerJob(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/export/state" || r.Header.Get("X-Resonance-Link-Token") != strings.Repeat("a", 64) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"deferred":true}`))
	}))
	defer server.Close()
	u := &usbTransfer{Status: "ready", Export: &usbPrepared{}, Connection: connection{ServerURL: server.URL + "/export", Token: strings.Repeat("a", 64)}}
	h := &helper{USB: u}
	done := make(chan struct{})
	go func() { h.watchUSB(u); close(done) }()
	select {
	case <-done:
	case <-time.After(7 * time.Second):
		t.Fatal("Bridge did not release the deferred export")
	}
	if h.USB != nil {
		t.Fatal("deferred export remained active in Bridge")
	}
}
func TestUSBFailureAndDestinationRace(t *testing.T) {
	b := usbFixture(t)
	p, _ := filepath.EvalSymlinks(t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if writeUSB(ctx, b, p, nil, nil) == nil {
		t.Fatal("cancelled write succeeded")
	}
	entries, _ := os.ReadDir(p)
	if len(entries) != 0 {
		t.Fatal("cancel left files")
	}
	calls := 0
	err := writeUSB(context.Background(), b, p, func() error {
		calls++
		if calls == 2 {
			os.Mkdir(filepath.Join(p, "Contents"), 0700)
			os.WriteFile(filepath.Join(p, "Contents", "keep.txt"), []byte("keep"), 0600)
		}
		return nil
	}, nil)
	if err == nil {
		t.Fatal("destination race allowed")
	}
	content, e := os.ReadFile(filepath.Join(p, "Contents", "keep.txt"))
	if e != nil || string(content) != "keep" {
		t.Fatal("foreign files removed")
	}
}
func TestUSBHTTPRequiresConfirmation(t *testing.T) {
	h := &helper{Cache: t.TempDir(), Sync: &synchronization{Connection: connection{Expires: time.Now().Add(time.Hour)}}}
	r := httptest.NewRequest("POST", "http://127.0.0.1:55460/api/usb/write", strings.NewReader(`{"id":"anything","confirm":false}`))
	r.Header.Set("X-Resonance-Link", "1")
	w := httptest.NewRecorder()
	h.routes("127.0.0.1:55460").ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
}
func TestUSBDirectDownloadRejectsUnsafeManifest(t *testing.T) {
	filesRequested := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/manifest") {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"schemaVersion":1,"profile":"dual","trackCount":1,"playlistName":"Test","files":[{"path":"../escape.mp3","bytes":1,"sha256":"` + strings.Repeat("a", 64) + `"}]}`))
			return
		}
		filesRequested = true
		w.WriteHeader(404)
	}))
	defer server.Close()
	cache := t.TempDir()
	c := connection{ServerURL: server.URL + "/transfer/" + strings.Repeat("a", 32), Token: strings.Repeat("b", 64)}
	if _, err := downloadUSBManifest(context.Background(), server.Client(), c); err == nil {
		t.Fatal("unsafe manifest accepted")
	}
	if filesRequested {
		t.Fatal("fetched a file from an unsafe manifest")
	}
	entries, _ := os.ReadDir(cache)
	if len(entries) != 0 {
		t.Fatal("unsafe manifest left staged files")
	}
}
func TestUSBDirectDownloadAndWrite(t *testing.T) {
	fixture := usbFixture(t)
	filesRequested := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/manifest"):
			http.ServeFile(w, r, filepath.Join(fixture.Root, "export-manifest.json"))
		case strings.HasSuffix(r.URL.Path, "/file"):
			filesRequested++
			http.ServeFile(w, r, filepath.Join(fixture.Root, filepath.FromSlash(r.URL.Query().Get("path"))))
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	c := connection{ServerURL: server.URL + "/transfer/" + strings.Repeat("a", 32), Token: strings.Repeat("b", 64)}
	downloaded, err := downloadUSBManifest(context.Background(), server.Client(), c)
	if err != nil {
		t.Fatal(err)
	}
	if filesRequested != 0 || downloaded.Manifest.TrackCount != fixture.Tracks {
		t.Fatal("manifest fetch downloaded tracks before USB selection")
	}
	target, _ := filepath.EvalSymlinks(t.TempDir())
	var bytesReceived int64
	if err = writeUSBStream(context.Background(), downloaded, c, target, nil, func(n int64, _, _ int) { bytesReceived += n }); err != nil {
		t.Fatal(err)
	}
	if filesRequested != len(downloaded.Manifest.Files) || bytesReceived != downloaded.Bytes {
		t.Fatal("stream transfer omitted files or bytes")
	}
	for _, spec := range downloaded.Manifest.Files {
		data, err := os.ReadFile(filepath.Join(target, filepath.FromSlash(spec.Path)))
		if err != nil || int64(len(data)) != spec.Bytes {
			t.Fatal("USB stream file missing or wrong size", spec.Path, err)
		}
	}
}
func TestUSBStreamRejectsChangedFileWithoutPublishing(t *testing.T) {
	fixture := usbFixture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/manifest"):
			http.ServeFile(w, r, filepath.Join(fixture.Root, "export-manifest.json"))
		case strings.HasSuffix(r.URL.Path, "/file"):
			data, err := os.ReadFile(filepath.Join(fixture.Root, filepath.FromSlash(r.URL.Query().Get("path"))))
			if err != nil || len(data) == 0 {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			data[0] ^= 1
			_, _ = w.Write(data)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	c := connection{ServerURL: server.URL + "/transfer/" + strings.Repeat("a", 32), Token: strings.Repeat("b", 64)}
	prepared, err := downloadUSBManifest(context.Background(), server.Client(), c)
	if err != nil {
		t.Fatal(err)
	}
	target, _ := filepath.EvalSymlinks(t.TempDir())
	if err = writeUSBStream(context.Background(), prepared, c, target, nil, nil); err == nil {
		t.Fatal("changed server file was accepted")
	}
	entries, err := os.ReadDir(target)
	if err != nil || len(entries) != 0 {
		t.Fatal("failed stream published files", err)
	}
}
func TestSharedHandoffRouting(t *testing.T) {
	usb := connection{1, "http://127.0.0.1/api/v0/analysis/usb-export/transfer/" + strings.Repeat("a", 32), strings.Repeat("b", 64), time.Now().Add(time.Hour)}
	if validateConnection(usb) != nil || documentView(&usb) != "/usb" {
		t.Fatal("USB handoff rejected")
	}
	usb.ServerURL = "http://127.0.0.1/api/v0/analysis/pioneer-link/sync"
	if validateConnection(usb) != nil || documentView(&usb) != "/settings" {
		t.Fatal("network handoff rejected")
	}
}

func TestUSBMidTransferCancellation(t *testing.T) {
	b := usbFixture(t)
	target, _ := filepath.EvalSymlinks(t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	err := writeUSB(ctx, b, target, nil, func(int, int) { cancel() })
	if err == nil {
		t.Fatal("cancel ignored")
	}
	entries, _ := os.ReadDir(target)
	if len(entries) > 0 {
		t.Fatal("partial export published")
	}
}
func TestUSBCorruptCacheDoesNotPublish(t *testing.T) {
	b := usbFixture(t)
	path := b.Library.Tracks()[0].FilePath
	f, e := os.OpenFile(path, os.O_WRONLY, 0600)
	if e != nil {
		t.Fatal(e)
	}
	f.WriteAt([]byte("CORRUPT"), 0)
	f.Close()
	target, _ := filepath.EvalSymlinks(t.TempDir())
	if writeUSB(context.Background(), b, target, nil, nil) == nil {
		t.Fatal("checksum mismatch allowed")
	}
	entries, _ := os.ReadDir(target)
	if len(entries) > 0 {
		t.Fatal("corrupt export published")
	}
}
