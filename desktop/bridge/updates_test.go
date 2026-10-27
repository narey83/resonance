// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
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

func testRelease(t *testing.T, body []byte) (signedRelease, string, release) {
	t.Helper()
	public, private, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	hash := sha256.Sum256(body)
	r := release{Version: "0.4.0", OS: runtime.GOOS, Arch: runtime.GOARCH, Size: int64(len(body)), SHA256: hex.EncodeToString(hash[:]), Protocol: 1}
	data, _ := json.Marshal(r)
	return signedRelease{base64.StdEncoding.EncodeToString(data), base64.StdEncoding.EncodeToString(ed25519.Sign(private, data))}, base64.StdEncoding.EncodeToString(public), r
}
func TestReleaseVerification(t *testing.T) {
	envelope, key, _ := testRelease(t, []byte("engine"))
	if _, e := verifyRelease(envelope, key); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"payload", "signature", "missing key", "wrong key", "size", "platform", "protocol", "version"} {
		t.Run(name, func(t *testing.T) {
			bad := envelope
			public := key
			switch name {
			case "payload":
				bad.Payload = base64.StdEncoding.EncodeToString([]byte("tampered"))
			case "signature":
				bad.Signature = "AAAA"
			case "missing key":
				public = ""
			case "wrong key":
				_, public, _ = testRelease(t, []byte("other"))
			default:
				pub, private, _ := ed25519.GenerateKey(rand.Reader)
				public = base64.StdEncoding.EncodeToString(pub)
				payload, _ := base64.StdEncoding.DecodeString(bad.Payload)
				var r release
				_ = json.Unmarshal(payload, &r)
				switch name {
				case "size":
					r.Size = maxUpdateBytes + 1
				case "platform":
					r.OS = "unsupported"
				case "protocol":
					r.Protocol = 2
				case "version":
					r.Version = "../evil"
				}
				payload, _ = json.Marshal(r)
				bad.Payload = base64.StdEncoding.EncodeToString(payload)
				bad.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(private, payload))
			}
			if _, e := verifyRelease(bad, public); e == nil {
				t.Fatal("accepted untrusted release")
			}
		})
	}
}
func TestReleaseVersionOrdering(t *testing.T) {
	for _, item := range []struct {
		a, b string
		want bool
	}{{"1.10.0", "1.9.9", true}, {"0.4.0", "0.4.0", false}, {"0.3.9", "0.4.0", false}, {"01.2.3", "0.0.1", false}, {"1.2.3-beta", "1.0.0", false}, {"1.2", "0.0.1", false}, {"4294967296.0.0", "0.0.1", false}} {
		if got := newerVersion(item.a, item.b); got != item.want {
			t.Errorf("%s > %s = %v", item.a, item.b, got)
		}
	}
}
func TestUpdateDownloadIntegrityAndRedirects(t *testing.T) {
	body := []byte("verified engine")
	envelope, key, r := testRelease(t, body)
	for _, mode := range []string{"valid", "tampered", "truncated", "oversized", "redirect", "unauthorized"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if req.Header.Get("X-Resonance-Link-Token") != "paired-token" {
					t.Error("missing pairing token")
				}
				if req.URL.Query().Get("sha256") != r.SHA256 {
					t.Error("missing release hash")
				}
				switch mode {
				case "tampered":
					w.Write(bytes.Repeat([]byte("x"), len(body)))
				case "truncated":
					w.Write(body[:3])
				case "oversized":
					w.Write(append(body, 'x'))
				case "redirect":
					http.Redirect(w, req, "https://example.invalid/credential-leak", 302)
				case "unauthorized":
					w.WriteHeader(401)
				default:
					w.Write(body)
				}
			}))
			defer server.Close()
			cache := t.TempDir()
			path, _, err := downloadRelease(context.Background(), updateClient(), connection{Token: "paired-token"}, server.URL, cache, envelope, key)
			if mode == "valid" {
				if err != nil {
					t.Fatal(err)
				}
				got, _ := os.ReadFile(path)
				if !bytes.Equal(got, body) {
					t.Fatal("wrong bytes")
				}
			} else if err == nil {
				t.Fatal("accepted invalid download")
			}
			entries, _ := os.ReadDir(filepath.Join(cache, "updates"))
			for _, entry := range entries {
				if strings.HasPrefix(entry.Name(), "download-") {
					t.Fatal("left a partial download")
				}
			}
		})
	}
}
func TestSelectedEngineRejectsTampering(t *testing.T) {
	body := []byte("engine")
	envelope, key, r := testRelease(t, body)
	before := updatePublicKey
	updatePublicKey = key
	defer func() { updatePublicKey = before }()
	cache := t.TempDir()
	_ = os.Mkdir(filepath.Join(cache, "updates"), 0700)
	_ = writePrivateJSON(filepath.Join(cache, "current-release.json"), envelope)
	target := filepath.Join(cache, "updates", r.SHA256+engineExtension())
	_ = os.WriteFile(target, body, 0700)
	if path, _, e := selectedEngine(cache); e != nil || path != target {
		t.Fatal(path, e)
	}
	_ = os.WriteFile(target, []byte("tampered"), 0700)
	if _, _, e := selectedEngine(cache); e == nil {
		t.Fatal("trusted modified executable")
	}
}
func TestIdleUpdateGate(t *testing.T) {
	for _, item := range []struct {
		name string
		h    *helper
		want bool
	}{
		{"idle", &helper{}, false}, {"sharing", &helper{Session: &session{}}, true}, {"sync", &helper{SyncActive: 1}, true},
		{"download", &helper{USB: &usbTransfer{Status: "downloading"}}, true}, {"write", &helper{USB: &usbTransfer{Status: "writing"}}, true},
		{"ready export", &helper{USB: &usbTransfer{Status: "ready"}}, true}, {"completed export", &helper{USB: &usbTransfer{Status: "completed"}}, false},
		{"failed export", &helper{USB: &usbTransfer{Status: "failed"}}, false},
	} {
		t.Run(item.name, func(t *testing.T) {
			if item.h.busyForUpdate() != item.want {
				t.Fatal("incorrect idle gate")
			}
		})
	}
}
func TestUpdateSourceValidation(t *testing.T) {
	c := connection{SchemaVersion: 1, ServerURL: "https://music.example/prefix/api/v0/analysis/pioneer-link/sync", Token: strings.Repeat("a", 64), Expires: time.Now().Add(time.Hour)}
	base, e := updatesBase(c)
	if e != nil || base != "https://music.example/prefix/api/v0/analysis/pioneer-link/updates/"+runtime.GOOS+"/"+runtime.GOARCH {
		t.Fatal(base, e)
	}
	c.ServerURL = "https://music.example/prefix/api/v0/helper/sync"
	if base, e = updatesBase(c); e != nil || !strings.Contains(base, "/helper/updates/") {
		t.Fatal(base, e)
	}
	for _, address := range []string{"http://public.example/api/v0/analysis/pioneer-link/sync", "https://user:password@example/api/v0/analysis/pioneer-link/sync", "https://example/api/v0/analysis/pioneer-link/sync?leak=token"} {
		c.ServerURL = address
		if _, e = updatesBase(c); e == nil {
			t.Fatal("accepted untrusted update source")
		}
	}
}
func TestDesktopRoutesRequireTrustedOrigin(t *testing.T) {
	h := (&helper{Cache: t.TempDir(), Updates: newUpdater()}).routes("127.0.0.1:55460")
	for _, path := range []string{"/api/desktop/startup", "/api/desktop/check-update"} {
		req := httptest.NewRequest("POST", "http://127.0.0.1:55460"+path, strings.NewReader(`{"enabled":true}`))
		req.Header.Set("Origin", "https://evil.example")
		req.Header.Set("X-Resonance-Link", "1")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != 403 {
			t.Fatal(w.Code)
		}
	}
}
func TestStartupPreferencePersists(t *testing.T) {
	cache := t.TempDir()
	if !startupEnabled(cache) {
		t.Fatal("startup must default on")
	}
	if e := writePrivateJSON(filepath.Join(cache, "startup.json"), startupSettings{false}); e != nil {
		t.Fatal(e)
	}
	if startupEnabled(cache) {
		t.Fatal("disabled preference lost")
	}
	if e := writePrivateJSON(filepath.Join(cache, "startup.json"), startupSettings{true}); e != nil {
		t.Fatal(e)
	}
	if !startupEnabled(cache) {
		t.Fatal("enabled preference lost")
	}
}
func TestLinuxStartupEscaping(t *testing.T) {
	path, data, e := startupEntry("linux", "/opt/Resonance Bridge/%f\"$`engine", "/home/test", "/home/test/.config")
	if e != nil || path != "/home/test/.config/autostart/resonance-pioneer-link.desktop" {
		t.Fatal(path, e)
	}
	if !strings.Contains(string(data), "%%f") || !strings.Contains(string(data), " --no-open\n") {
		t.Fatal(string(data))
	}
}
func TestRollbackUsesLastHealthySignedRelease(t *testing.T) {
	cache := t.TempDir()
	envelope, key, _ := testRelease(t, []byte("good"))
	before := updatePublicKey
	updatePublicKey = key
	defer func() { updatePublicKey = before }()
	if e := writePrivateJSON(filepath.Join(cache, "last-good-release.json"), envelope); e != nil {
		t.Fatal(e)
	}
	_ = os.WriteFile(filepath.Join(cache, "current-release.json"), []byte("bad"), 0600)
	rollbackRelease(cache)
	data, _ := os.ReadFile(filepath.Join(cache, "current-release.json"))
	var got signedRelease
	if json.Unmarshal(data, &got) != nil || got != envelope {
		t.Fatal("did not restore signed metadata")
	}
	_ = os.Remove(filepath.Join(cache, "last-good-release.json"))
	rollbackRelease(cache)
	if _, e := os.Stat(filepath.Join(cache, "current-release.json")); !os.IsNotExist(e) {
		t.Fatal("fallback to packaged version failed")
	}
}

func TestLinuxStartupRegistrationCanBeDisabled(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux startup integration")
	}
	home := t.TempDir()
	config := filepath.Join(home, "config")
	cache := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", config)
	t.Setenv("RESONANCE_HELPER_INSTALLED_ENGINE", "/opt/Resonance Bridge/engine")
	if err := configureStartup(cache, true); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(config, "autostart", "resonance-pioneer-link.desktop")
	data, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(data), " --no-open") {
		t.Fatal(string(data), err)
	}
	if err = configureStartup(cache, false); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("startup entry still present")
	}
	if startupEnabled(cache) {
		t.Fatal("disabled preference did not persist")
	}
}
func TestSyncNetworkActivityDefersSoftwareUpdate(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done() }))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &synchronization{Connection: connection{ServerURL: server.URL}}
	h := &helper{Sync: s}
	done := make(chan error, 1)
	go func() { done <- h.syncOnce(ctx, server.Client(), s) }()
	<-started
	h.mu.Lock()
	busy := h.busyForUpdate()
	h.mu.Unlock()
	if !busy {
		t.Fatal("in-flight sync did not defer software update")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("sync did not cancel")
	}
	h.mu.Lock()
	busy = h.busyForUpdate()
	h.mu.Unlock()
	if busy {
		t.Fatal("cancelled sync kept the helper busy")
	}
}
