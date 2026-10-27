// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/vynulldev/vynull/dbclient"
	"github.com/vynulldev/vynull/nfs"
	"github.com/vynulldev/vynull/proto"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPaths(t *testing.T) {
	for _, p := range []string{"../x", "Contents/../x", "/Contents/x", "Contents/x\\y", "Contents/CON", "other/x"} {
		if _, e := safeName(p); e == nil {
			t.Errorf("unsafe %s", p)
		}
	}
}
func TestOrigins(t *testing.T) {
	h := (&helper{}).routes("127.0.0.1:55460")
	for _, origin := range []string{"https://evil.example", "http://127.0.0.1:55555"} {
		r := httptest.NewRequest("POST", "http://127.0.0.1:55460/api/stop", nil)
		r.Header.Set("Origin", origin)
		r.Header.Set("X-Resonance-Link", "1")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal(w.Code)
		}
	}
	r := httptest.NewRequest("POST", "http://127.0.0.1:55460/api/stop", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
}
func TestRealImport(t *testing.T) {
	p := os.Getenv("RESONANCE_TEST_BUNDLE_ZIP")
	if p == "" {
		t.Skip()
	}
	if _, e := importBundle(p, t.TempDir()); e != nil {
		t.Fatal(e)
	}
}
func TestLoopback(t *testing.T) {
	root := os.Getenv("RESONANCE_TEST_EXPORT_ROOT")
	if root == "" {
		t.Skip()
	}
	d, e := os.ReadFile(filepath.Join(root, "export-manifest.json"))
	if e != nil {
		t.Fatal(e)
	}
	var m exportManifest
	json.Unmarshal(d, &m)
	b, e := loadBundle(root, m)
	if e != nil {
		t.Fatal(e)
	}
	var a adapter
	for _, v := range adapters(true) {
		if v.IP == "127.0.0.1" {
			a = v
		}
	}
	if a.Name == "" {
		t.Fatal("loopback missing")
	}
	h := &helper{Library: b, AllowLoopback: true}
	if e = h.start(a.Name, a.IP); e != nil {
		t.Fatal(e)
	}
	defer h.stop()

	packet := proto.MarshalKeepAlive("TEST-CDJ", 1, proto.DeviceCDJ, net.HardwareAddr{2, 0, 0, 0, 0, 2}, net.ParseIP("127.0.0.2"), 0)
	if !h.Session.Device.Peers.HandlePacket(packet) || len(h.Session.Device.Peers.Peers()) != 1 {
		t.Fatal("discovery packet parsing failed")
	}
	c, e := dbclient.Dial(net.ParseIP(a.IP), int(h.Session.DB.QueryPort()), 1)
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	for _, track := range b.DB.Tracks {
		meta, e := c.FetchMetadata(dbclient.SlotRekordbox, track.ID)
		if e != nil {
			t.Fatal(e)
		}
		if meta.Title != track.Title {
			t.Fatalf("title %q != %q", meta.Title, track.Title)
		}
	}
	if len(preparedPlaylists(b.DB.PlaylistTree).Children(0)) == 0 {
		t.Fatal("playlist missing")
	}
	fs, e := nfs.Dial(net.ParseIP(a.IP), time.Second)
	if e != nil {
		t.Fatal(e)
	}
	exports, e := fs.Exports()
	if e != nil || len(exports) == 0 {
		t.Fatalf("%v %v", exports, e)
	}
	got, e := fs.ReadFile(exports[0], "PIONEER/rekordbox/export.pdb")
	if e != nil {
		t.Fatal(e)
	}
	want, _ := os.ReadFile(filepath.Join(root, "PIONEER/rekordbox/export.pdb"))
	if !bytes.Equal(got, want) {
		t.Fatal("PDB bytes differ")
	}

	for _, spec := range m.Files {
		if strings.HasSuffix(spec.Path, ".DAT") || strings.HasSuffix(spec.Path, ".EXT") || strings.HasSuffix(spec.Path, ".2EX") || strings.HasSuffix(spec.Path, ".wav") {
			data, err := fs.ReadFile(exports[0], spec.Path)
			if err != nil {
				t.Fatal(err)
			}
			hash := sha256.Sum256(data)
			if hex.EncodeToString(hash[:]) != spec.SHA256 {
				t.Fatalf("served bytes differ: %s", spec.Path)
			}
		}
	}
	if e = h.stop(); e != nil {
		t.Fatal(e)
	}
	if e = probePorts(a.IP, a.IP); e != nil {
		t.Fatal(e)
	}
	if e = h.start(a.Name, a.IP); e != nil {
		t.Fatal(e)
	}
	t.Logf("%d tracks metadata, playlist, NFS PDB, stop/restart verified", len(b.DB.Tracks))
}

func TestUnmanifestedArchive(t *testing.T) {
	p := filepath.Join(t.TempDir(), "bad.zip")
	f, _ := os.Create(p)
	z := zip.NewWriter(f)
	w, _ := z.Create("export-manifest.json")
	w.Write([]byte(`{"schemaVersion":1,"trackCount":1,"playlistName":"Test","files":[]}`))
	w, _ = z.Create("Contents/hidden.wav")
	w.Write([]byte("hidden"))
	z.Close()
	f.Close()
	if _, e := importBundle(p, t.TempDir()); e == nil {
		t.Fatal("unlisted file accepted")
	}
}
