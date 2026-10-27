// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func pairingTestConnection(t *testing.T) connection {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(syncManifest{Protocol: 2, Revision: strings.Repeat("a", 64), Status: "waiting-analysis", Message: "Connected; waiting for fully analysed tracks"})
	}))
	t.Cleanup(server.Close)
	return connection{SchemaVersion: 1, ServerURL: server.URL + "/api/v0/bridge/sync", Token: strings.Repeat("b", 64), Expires: time.Now().Add(time.Hour)}
}
func TestPairingSurvivesCacheRemovalAndFreshHelper(t *testing.T) {
	root := t.TempDir()
	config := filepath.Join(root, "settings")
	cache := filepath.Join(root, "cache")
	os.MkdirAll(cache, 0700)
	c := pairingTestConnection(t)
	original := &helper{Cache: cache, PairingDirectory: config}
	if e := original.savePairing(c); e != nil {
		t.Fatal("could not save test pairing")
	}
	if e := os.RemoveAll(cache); e != nil {
		t.Fatal(e)
	}
	os.MkdirAll(cache, 0700)
	restarted := &helper{Cache: cache, PairingDirectory: config}
	restarted.restorePairing()
	defer restarted.disconnect()
	restarted.mu.Lock()
	paired := restarted.Sync != nil && restarted.Sync.Connection.Token == c.Token && restarted.Sync.Connection.ServerURL == c.ServerURL
	restarted.mu.Unlock()
	if !paired {
		t.Fatal("saved pairing was not restored after restarting with an empty cache")
	}
	info, e := os.Stat(restarted.pairingPath())
	if e != nil {
		t.Fatal(e)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatal("pairing permissions are not private")
	}
}
func TestLegacyPairingMigratesAndDisconnectDoesNotResurrectIt(t *testing.T) {
	root := t.TempDir()
	cache := filepath.Join(root, "cache")
	os.MkdirAll(cache, 0700)
	c := pairingTestConnection(t)
	legacy := filepath.Join(cache, "connection.json")
	if e := writePrivateJSON(legacy, c); e != nil {
		t.Fatal(e)
	}
	h := &helper{Cache: cache, PairingDirectory: filepath.Join(root, "settings")}
	h.restorePairing()
	if _, e := os.Stat(h.pairingPath()); e != nil {
		t.Fatal("legacy pairing was not migrated")
	}
	h.disconnect()
	restarted := &helper{Cache: cache, PairingDirectory: h.PairingDirectory}
	restarted.restorePairing()
	if restarted.Sync != nil {
		restarted.disconnect()
		t.Fatal("forgotten pairing was resurrected")
	}
}
func TestCorruptOrExpiredPairingProducesVisibleRestoreError(t *testing.T) {
	for _, expired := range []bool{false, true} {
		t.Run(map[bool]string{false: "corrupt", true: "expired"}[expired], func(t *testing.T) {
			root := t.TempDir()
			h := &helper{Cache: root, PairingDirectory: root}
			data := []byte("invalid")
			if expired {
				c := pairingTestConnection(t)
				c.Expires = time.Now().Add(-time.Hour)
				data, _ = json.Marshal(c)
			}
			os.WriteFile(h.pairingPath(), data, 0600)
			h.restorePairing()
			if h.Sync != nil || !strings.Contains(h.Error, "saved pairing") {
				t.Fatal("restore failure was silent")
			}
			if _, e := os.Stat(h.pairingPath()); e != nil {
				t.Fatal("failed restore erased the pairing")
			}
		})
	}
}
