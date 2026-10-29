// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"time"
)

var lastBridgeSyncLatencyMS atomic.Int64

type connection struct {
	SchemaVersion int       `json:"schemaVersion"`
	ServerURL     string    `json:"serverUrl"`
	Token         string    `json:"token"`
	Expires       time.Time `json:"expires"`
}
type synchronization struct {
	Theme      string
	Rejected   bool
	Connection connection
	Cancel     context.CancelFunc
	Revision   string
	Status     string
	Error      string
	Updated    time.Time
}

func validateConnection(c connection) error {
	u, e := url.Parse(c.ServerURL)
	if e != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") || (!strings.HasSuffix(u.Path, "/analysis/pioneer-link/sync") && !strings.HasSuffix(u.Path, "/helper/sync") && !strings.HasSuffix(u.Path, "/bridge/sync") && !isUSB(c)) || c.SchemaVersion != 1 || len(c.Token) != 64 || !c.Expires.After(time.Now()) {
		return errors.New("invalid or expired Resonance connection file")
	}
	if u.Scheme == "http" {
		ip := net.ParseIP(u.Hostname())
		if u.Hostname() != "localhost" && (ip == nil || (!ip.IsPrivate() && !ip.IsLoopback())) {
			return errors.New("use HTTPS for a remote Resonance server; HTTP is allowed only on a private or loopback IP")
		}
	}
	return nil
}
func canonicalBridgeConnection(c connection) connection {
	for _, legacy := range []string{"/analysis/pioneer-link/sync", "/helper/sync"} {
		if strings.HasSuffix(c.ServerURL, legacy) {
			c.ServerURL = strings.TrimSuffix(c.ServerURL, legacy) + "/bridge/sync"
			break
		}
	}
	return c
}
func (h *helper) disconnect() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.Session != nil || (h.USB != nil && (h.USB.Status == "downloading" || h.USB.Status == "writing")) {
		return errors.New("Stop Network Link and finish the USB transfer before forgetting the pairing")
	}
	for _, path := range []string{filepath.Join(h.Cache, "connection.json"), h.pairingPath()} {
		if e := os.Remove(path); e != nil && !errors.Is(e, os.ErrNotExist) {
			return errors.New("Could not remove the saved pairing. Check app settings permissions")
		}
	}
	if h.Sync != nil {
		h.Sync.Cancel()
		h.Sync = nil
	}
	h.Library = nil
	h.Error = ""
	h.Diagnostics.event("info", "connection.disconnected", nil)
	return nil
}
func (h *helper) connect(c connection) error {
	if isUSB(c) {
		return errors.New("This is a USB export file. Choose a Bridge pairing file in Settings instead.")
	}
	c = canonicalBridgeConnection(c)
	if e := validateConnection(c); e != nil {
		return e
	}
	h.mu.Lock()
	busy := h.Session != nil || (h.USB != nil && (h.USB.Status == "downloading" || h.USB.Status == "writing"))
	h.mu.Unlock()
	if busy {
		return errors.New("Stop Network Link and finish the USB transfer before changing the pairing")
	}
	if e := h.savePairing(c); e != nil {
		return e
	}
	h.mu.Lock()
	if h.Updating {
		h.mu.Unlock()
		return errors.New("helper update is restarting")
	}
	if h.Sync == nil || h.Sync.Connection.ServerURL != c.ServerURL {
		h.Library = nil
	}
	if h.Sync != nil {
		h.Sync.Cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &synchronization{Connection: c, Cancel: cancel, Status: "Connecting", Theme: h.savedAppearance(c)}
	h.Sync = s
	h.Error = ""
	h.mu.Unlock()
	h.Diagnostics.event("info", "connection.saved", map[string]any{"server": c.ServerURL})
	go h.syncLoop(ctx, s)
	go h.appearanceLoop(ctx, s)
	if h.Updates != nil {
		h.Updates.check()
	}
	return nil
}
func (h *helper) syncState(s *synchronization, status string, e error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.Sync != s {
		return
	}
	previousStatus, previousError := s.Status, s.Error
	s.Status = status
	s.Error = ""
	if e != nil {
		s.Error = e.Error()
		if errors.Is(e, errPairingRejected) {
			s.Rejected = true
		}
	}
	if s.Status != previousStatus || s.Error != previousError {
		level := "info"
		if e != nil {
			level = "warning"
		}
		h.Diagnostics.event(level, "library.sync", map[string]any{"status": s.Status, "error": s.Error})
	}
}
func (h *helper) syncLoop(ctx context.Context, s *synchronization) {
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("server redirects are not allowed for helper credentials")
	}}
	for {
		if e := h.syncOnce(ctx, client, s); e != nil && ctx.Err() == nil {
			h.syncState(s, "Waiting to retry", e)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(15 * time.Second):
		}
	}
}
func fetchSync(ctx context.Context, client *http.Client, c connection, suffix string) (*http.Response, error) {
	req, e := http.NewRequestWithContext(ctx, "GET", c.ServerURL+suffix, nil)
	if e != nil {
		return nil, e
	}
	req.Header.Set("X-Resonance-Link-Token", c.Token)
	req.Header.Set("X-Resonance-Bridge-Version", helperVersion)
	req.Header.Set("X-Resonance-Bridge-Platform", runtime.GOOS)
	req.Header.Set("X-Resonance-Bridge-Architecture", runtime.GOARCH)
	req.Header.Set("X-Resonance-Bridge-Latency-Ms", fmt.Sprint(lastBridgeSyncLatencyMS.Load()))
	if name, err := os.Hostname(); err == nil {
		req.Header.Set("X-Resonance-Bridge-Name", name)
	}
	if address := outboundAddress(c.ServerURL); address != "" {
		req.Header.Set("X-Resonance-Bridge-Address", address)
	}
	response, e := client.Do(req)
	if e != nil {
		return nil, e
	}
	if response.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		response.Body.Close()
		if response.StatusCode == 401 {
			return nil, errPairingRejected
		}
		message := strings.TrimSpace(string(body))
		var parsed any
		if json.Unmarshal(body, &parsed) == nil {
			switch value := parsed.(type) {
			case string:
				message = value
			case map[string]any:
				if detail, ok := value["error"].(string); ok {
					message = detail
				}
			}
		}
		if strings.HasPrefix(message, "<") || len(message) > 1000 {
			message = ""
		}
		if message != "" {
			return nil, fmt.Errorf("Resonance returned HTTP %d: %s", response.StatusCode, redactDiagnostic(message))
		}
		return nil, fmt.Errorf("Resonance returned HTTP %d", response.StatusCode)
	}
	return response, nil
}

func outboundAddress(serverURL string) string {
	u, err := url.Parse(serverURL)
	if err != nil {
		return ""
	}
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	conn, err := net.DialTimeout("udp", net.JoinHostPort(u.Hostname(), port), time.Second)
	if err != nil {
		return ""
	}
	defer conn.Close()
	if local, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return local.IP.String()
	}
	return ""
}
func (h *helper) syncOnce(ctx context.Context, client *http.Client, s *synchronization) error {
	h.mu.Lock()
	if h.Updating {
		h.mu.Unlock()
		return context.Canceled
	}
	h.SyncActive++
	h.mu.Unlock()
	defer func() { h.mu.Lock(); h.SyncActive--; h.mu.Unlock() }()
	poll, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	started := time.Now()
	response, e := fetchSync(poll, client, s.Connection, "")
	lastBridgeSyncLatencyMS.Store(time.Since(started).Milliseconds())
	if e != nil {
		return e
	}
	var status syncManifest /* legacy and batch protocols */
	e = json.NewDecoder(io.LimitReader(response.Body, 16<<20)).Decode(&status)
	response.Body.Close()
	if e != nil {
		return e
	}
	if status.Protocol == 2 || status.Protocol == 3 {
		return h.syncBatches(ctx, client, s, status)
	}
	if status.Job == nil {
		return errors.New("library is not ready")
	}
	h.mu.Lock()
	current := h.Sync == s
	revision := s.Revision
	h.mu.Unlock()
	if !current {
		return context.Canceled
	}
	if status.Job.Status != "completed" {
		if status.Job.Status == "failed" {
			return fmt.Errorf("library preparation: %s; existing music remains available", status.Job.Error)
		}
		h.syncState(s, "Preparing whole library · "+status.Job.Status, nil)
		return nil
	}
	if status.Revision == revision {
		h.syncState(s, "Up to date · automatic updates on", nil)
		return nil
	}
	h.syncState(s, "Downloading and verifying library update", nil)
	download, stop := context.WithTimeout(ctx, 2*time.Hour)
	defer stop()
	response, e = fetchSync(download, client, s.Connection, "/download/"+url.PathEscape(status.Job.JobID))
	if e != nil {
		return e
	}
	defer response.Body.Close()
	f, e := os.CreateTemp(h.Cache, "sync-*.zip")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	n, e := io.Copy(f, io.LimitReader(response.Body, maxBundleBytes+1))
	f.Close()
	if e != nil {
		return e
	}
	if n > maxBundleBytes {
		return errors.New("library exceeds helper cache limit (50 GiB)")
	}
	next, e := importBundle(f.Name(), h.Cache)
	if e != nil {
		return e
	}
	h.operation.Lock()
	defer h.operation.Unlock()
	h.mu.Lock()
	current = h.Sync == s && ctx.Err() == nil
	h.mu.Unlock()
	if !current {
		os.RemoveAll(next.Root)
		return context.Canceled
	}
	if e = h.install(next); e != nil {
		os.RemoveAll(next.Root)
		return e
	}
	h.mu.Lock()
	s.Revision = status.Revision
	s.Status = "Up to date · automatic updates on"
	s.Error = ""
	s.Updated = time.Now()
	h.mu.Unlock()
	return nil
}
func (h *helper) syncRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/connect", func(w http.ResponseWriter, r *http.Request) {
		h.operation.Lock()
		defer h.operation.Unlock()
		var c connection
		if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536)).Decode(&c); e != nil {
			jsonReply(w, 400, map[string]string{"error": "select a valid connection JSON file"})
			return
		}
		if e := h.connect(c); e != nil {
			jsonReply(w, 400, map[string]string{"error": e.Error()})
			return
		}
		jsonReply(w, 200, h.snapshot())
	})
	mux.HandleFunc("POST /api/disconnect", func(w http.ResponseWriter, r *http.Request) {
		h.operation.Lock()
		defer h.operation.Unlock()
		if e := h.disconnect(); e != nil {
			jsonReply(w, 409, map[string]string{"error": e.Error()})
			return
		}
		jsonReply(w, 200, h.snapshot())
	})
}
