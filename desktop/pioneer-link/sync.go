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
	"strings"
	"time"
)

type connection struct {
	SchemaVersion int       `json:"schemaVersion"`
	ServerURL     string    `json:"serverUrl"`
	Token         string    `json:"token"`
	Expires       time.Time `json:"expires"`
}
type synchronization struct {
	Connection connection
	Cancel     context.CancelFunc
	Revision   string
	Status     string
	Error      string
	Updated    time.Time
}

func validateConnection(c connection) error {
	u, e := url.Parse(c.ServerURL)
	if e != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") || (!strings.HasSuffix(u.Path, "/analysis/pioneer-link/sync") && !isUSB(c)) || c.SchemaVersion != 1 || len(c.Token) != 64 || !c.Expires.After(time.Now()) {
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
func (h *helper) disconnect() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.Sync != nil {
		h.Sync.Cancel()
		h.Sync = nil
	}
	os.Remove(filepath.Join(h.Cache, "connection.json"))
}
func (h *helper) connect(c connection) error {
	if e := validateConnection(c); e != nil {
		return e
	}
	data, _ := json.Marshal(c)
	if e := os.WriteFile(filepath.Join(h.Cache, "connection.json"), data, 0600); e != nil {
		return e
	}
	h.mu.Lock()
	if h.Sync != nil {
		h.Sync.Cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &synchronization{Connection: c, Cancel: cancel, Status: "Connecting"}
	h.Sync = s
	h.mu.Unlock()
	go h.syncLoop(ctx, s)
	return nil
}
func (h *helper) syncState(s *synchronization, status string, e error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.Sync != s {
		return
	}
	s.Status = status
	s.Error = ""
	if e != nil {
		s.Error = e.Error()
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
	response, e := client.Do(req)
	if e != nil {
		return nil, e
	}
	if response.StatusCode != 200 {
		response.Body.Close()
		if response.StatusCode == 401 {
			return nil, errors.New("connection expired or revoked; download a new connection file in Resonance")
		}
		return nil, fmt.Errorf("Resonance returned HTTP %d", response.StatusCode)
	}
	return response, nil
}
func (h *helper) syncOnce(ctx context.Context, client *http.Client, s *synchronization) error {
	poll, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	response, e := fetchSync(poll, client, s.Connection, "")
	if e != nil {
		return e
	}
	var status struct {
		Revision string `json:"revision"`
		Job      *struct {
			JobID  string `json:"jobId"`
			Status string `json:"status"`
			Error  string `json:"error"`
			Total  int    `json:"total"`
		} `json:"job"`
	}
	e = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&status)
	response.Body.Close()
	if e != nil {
		return e
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
		h.disconnect()
		jsonReply(w, 200, h.snapshot())
	})
}
