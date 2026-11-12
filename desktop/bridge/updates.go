// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Set by the release build. A missing key disables executable downloads.
var helperVersion = "0.3.24"
var updatePublicKey string

const maxUpdateBytes int64 = 128 << 20

type release struct {
	Version  string `json:"version"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Size     int64  `json:"size"`
	SHA256   string `json:"sha256"`
	Protocol int    `json:"protocol"`
}
type signedRelease struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}
type updateView struct {
	Version   string `json:"version"`
	Status    string `json:"status"`
	Error     string `json:"error,omitempty"`
	Available string `json:"available,omitempty"`
}
type updater struct {
	diagnostics *bridgeDiagnostics
	mu          sync.Mutex
	view        updateView
	wake        chan struct{}
}

func newUpdater() *updater {
	status := "Waiting for a Resonance connection"
	if updatePublicKey == "" {
		status = "Updates unavailable: this build has no release verification key"
	}
	return &updater{view: updateView{Version: helperVersion, Status: status}, wake: make(chan struct{}, 1)}
}
func (u *updater) snapshot() updateView { u.mu.Lock(); defer u.mu.Unlock(); return u.view }
func (u *updater) state(status string, err error, version string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	previous := u.view
	u.view.Status = status
	u.view.Available = version
	u.view.Error = ""
	if err != nil {
		u.view.Error = err.Error()
	}
	if previous != u.view {
		u.diagnostics.event("info", "software.update", map[string]any{"status": status, "error": u.view.Error, "available": version})
	}
}
func (u *updater) check() {
	select {
	case u.wake <- struct{}{}:
	default:
	}
}
func versionParts(v string) ([3]uint64, error) {
	var result [3]uint64
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return result, errors.New("release version must be major.minor.patch")
	}
	for i, p := range parts {
		if p == "" || (len(p) > 1 && p[0] == '0') {
			return result, errors.New("invalid release version")
		}
		for _, c := range p {
			if c < '0' || c > '9' {
				return result, errors.New("invalid release version")
			}
		}
		n, e := strconv.ParseUint(p, 10, 32)
		if e != nil {
			return result, e
		}
		result[i] = n
	}
	return result, nil
}
func newerVersion(a, b string) bool {
	av, e := versionParts(a)
	if e != nil {
		return false
	}
	bv, e := versionParts(b)
	if e != nil {
		return false
	}
	for i := range av {
		if av[i] != bv[i] {
			return av[i] > bv[i]
		}
	}
	return false
}
func verifyRelease(envelope signedRelease, key string) (release, error) {
	var r release
	public, e := base64.StdEncoding.DecodeString(key)
	if e != nil || len(public) != ed25519.PublicKeySize {
		return r, errors.New("invalid release verification key")
	}
	payload, e := base64.StdEncoding.DecodeString(envelope.Payload)
	if e != nil || len(payload) > 16384 {
		return r, errors.New("invalid release metadata")
	}
	signature, e := base64.StdEncoding.DecodeString(envelope.Signature)
	if e != nil || !ed25519.Verify(public, payload, signature) {
		return r, errors.New("release signature verification failed")
	}
	if e = json.Unmarshal(payload, &r); e != nil {
		return r, e
	}
	hash, e := hex.DecodeString(r.SHA256)
	if e != nil || len(hash) != sha256.Size || r.SHA256 != strings.ToLower(r.SHA256) || r.Size <= 0 || r.Size > maxUpdateBytes || r.Protocol != 1 || r.OS != runtime.GOOS || r.Arch != runtime.GOARCH {
		return r, errors.New("release does not match this helper or exceeds its size limit")
	}
	if _, e = versionParts(r.Version); e != nil {
		return r, e
	}
	return r, nil
}
func updatesBase(c connection) (string, error) {
	if e := validateConnection(c); e != nil {
		return "", e
	}
	u, e := url.Parse(c.ServerURL)
	if e != nil {
		return "", e
	}
	// USB tokens cannot authorize software updates. Pair a Network Link connection first.
	if isUSB(c) {
		return "", errors.New("pair a Resonance library connection to enable helper updates")
	}
	u.Path = strings.TrimSuffix(u.Path, "/sync") + "/updates/" + runtime.GOOS + "/" + runtime.GOARCH
	return u.String(), nil
}
func updateClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("helper update redirects are not allowed")
	}}
}
func updateGET(ctx context.Context, client *http.Client, c connection, address string) (*http.Response, error) {
	req, e := http.NewRequestWithContext(ctx, "GET", address, nil)
	if e != nil {
		return nil, e
	}
	req.Header.Set("X-Resonance-Link-Token", c.Token)
	response, e := client.Do(req)
	if e != nil {
		return nil, e
	}
	if response.StatusCode != 200 {
		response.Body.Close()
		return nil, fmt.Errorf("instance update service returned HTTP %d", response.StatusCode)
	}
	return response, nil
}
func downloadRelease(ctx context.Context, client *http.Client, c connection, base, cache string, envelope signedRelease, key string) (string, release, error) {
	r, e := verifyRelease(envelope, key)
	if e != nil {
		return "", r, e
	}
	response, e := updateGET(ctx, client, c, base+"/binary?sha256="+r.SHA256)
	if e != nil {
		return "", r, e
	}
	defer response.Body.Close()
	dir := filepath.Join(cache, "updates")
	if e = os.MkdirAll(dir, 0700); e != nil {
		return "", r, e
	}
	file, e := os.CreateTemp(dir, "download-*")
	if e != nil {
		return "", r, e
	}
	defer os.Remove(file.Name())
	hash := sha256.New()
	n, e := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, r.Size+1))
	if e == nil {
		e = file.Sync()
	}
	closeErr := file.Close()
	if e == nil {
		e = closeErr
	}
	if e != nil {
		return "", r, e
	}
	if n != r.Size || hex.EncodeToString(hash.Sum(nil)) != strings.ToLower(r.SHA256) {
		return "", r, errors.New("helper update size or checksum verification failed")
	}
	target := filepath.Join(dir, r.SHA256+engineExtension())
	if e = os.Chmod(file.Name(), 0700); e != nil {
		return "", r, e
	}
	// Hash-addressed immutable executable; a previous staged file is never trusted blindly.
	if _, e = os.Stat(target); e == nil {
		if e = os.Remove(target); e != nil {
			return "", r, e
		}
	}
	if e = os.Rename(file.Name(), target); e != nil {
		return "", r, e
	}
	return target, r, nil
}
func engineExtension() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}
func writePrivateJSON(path string, value any) error {
	data, e := json.Marshal(value)
	if e != nil {
		return e
	}
	file, e := os.CreateTemp(filepath.Dir(path), ".settings-*")
	if e != nil {
		return e
	}
	defer os.Remove(file.Name())
	if _, e = file.Write(data); e == nil {
		e = file.Sync()
	}
	closeErr := file.Close()
	if e == nil {
		e = closeErr
	}
	if e != nil {
		return e
	}
	return replaceSettings(file.Name(), path)
}

// Called with h.mu held. Synchronization covers the download, verification and install.
func (h *helper) busyForUpdate() bool {
	return h.Session != nil || h.SyncActive > 0 || (h.USB != nil && (h.USB.Status == "downloading" || h.USB.Status == "writing" || h.USB.Status == "ready"))
}
func (h *helper) updateLoop(ctx context.Context) {
	u := h.Updates
	if updatePublicKey == "" {
		return
	}
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	retry := time.NewTimer(time.Second)
	defer retry.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-retry.C:
		case <-u.wake:
		}
		h.mu.Lock()
		var c connection
		if h.Sync != nil {
			c = h.Sync.Connection
		}
		h.mu.Unlock()
		if c.ServerURL == "" {
			u.state("Waiting for a Resonance connection", nil, "")
			retry.Reset(time.Minute)
			continue
		}
		base, e := updatesBase(c)
		if e != nil {
			u.state("Cannot check for updates", e, "")
			retry.Reset(time.Hour)
			continue
		}
		checkCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
		client := updateClient()
		response, e := updateGET(checkCtx, client, c, base)
		var envelope signedRelease
		if e == nil {
			e = json.NewDecoder(io.LimitReader(response.Body, 32769)).Decode(&envelope)
			response.Body.Close()
		}
		var r release
		if e == nil {
			r, e = verifyRelease(envelope, updatePublicKey)
		}
		if e != nil {
			cancel()
			u.state("Update check failed; will retry", e, "")
			retry.Reset(time.Hour)
			continue
		}
		if rejectedData, readErr := os.ReadFile(filepath.Join(h.Cache, "rejected-release.json")); readErr == nil {
			var rejected signedRelease
			if json.Unmarshal(rejectedData, &rejected) == nil && rejected == envelope {
				cancel()
				u.state("Previous update failed to start; waiting for a new release", nil, r.Version)
				continue
			}
		}
		if !newerVersion(r.Version, helperVersion) {
			cancel()
			u.state("Up to date", nil, "")
			continue
		}
		u.state("Downloading verified update", nil, r.Version)
		_, r, e = downloadRelease(checkCtx, client, c, base, h.Cache, envelope, updatePublicKey)
		cancel()
		if e != nil {
			u.state("Update download failed; will retry", e, r.Version)
			retry.Reset(time.Hour)
			continue
		}
		u.state("Downloaded; waiting until the helper is idle", nil, r.Version)
		for ctx.Err() == nil {
			if h.operation.TryLock() {
				h.mu.Lock()
				// The source must still be the same paired instance when activating downloaded code.
				same := h.Sync != nil && h.Sync.Connection == c
				if same && !h.busyForUpdate() && !h.Updating {
					h.Updating = true
					e = writePrivateJSON(filepath.Join(h.Cache, "current-release.json"), envelope)
					if e == nil {
						h.RestartForUpdate = true
						h.Shutdown()
					} else {
						h.Updating = false
					}
					h.mu.Unlock()
					h.operation.Unlock()
					if e != nil {
						u.state("Could not activate update", e, r.Version)
					}
					return
				}
				h.mu.Unlock()
				h.operation.Unlock()
				if !same {
					u.check()
					break
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
		}
	}
}
