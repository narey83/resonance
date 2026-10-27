// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type savedAppearance struct {
	Instance string `json:"instance"`
	Theme    string `json:"theme"`
}

func validTheme(theme string) bool {
	switch theme {
	case "light", "amoled", "midnight", "violet", "ember", "system":
		return true
	}
	return false
}

func (h *helper) appearancePath() string {
	return filepath.Join(filepath.Dir(h.pairingPath()), "appearance.json")
}

func (h *helper) savedAppearance(c connection) string {
	data, err := os.ReadFile(h.appearancePath())
	if err != nil || len(data) > 4096 {
		return ""
	}
	var saved savedAppearance
	if json.Unmarshal(data, &saved) != nil || saved.Instance != instanceIdentity(c) || !validTheme(saved.Theme) {
		return ""
	}
	return saved.Theme
}

func (h *helper) appearanceLoop(ctx context.Context, s *synchronization) {
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for {
		h.refreshAppearance(ctx, client, s)
		select {
		case <-ctx.Done():
			return
		case <-time.After(15 * time.Second):
		}
	}
}

func (h *helper) refreshAppearance(ctx context.Context, client *http.Client, s *synchronization) {
	address := strings.TrimSuffix(s.Connection.ServerURL, "/sync") + "/appearance"
	req, err := http.NewRequestWithContext(ctx, "GET", address, nil)
	if err != nil {
		return
	}
	req.Header.Set("X-Resonance-Link-Token", s.Connection.Token)
	response, err := client.Do(req)
	if err != nil {
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return
	}
	var appearance struct {
		Theme string `json:"theme"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&appearance) != nil || !validTheme(appearance.Theme) {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.Sync != s || s.Rejected || ctx.Err() != nil || s.Theme == appearance.Theme {
		return
	}
	// Persist before exposing the new value, so restart and offline views agree.
	if writePrivateJSON(h.appearancePath(), savedAppearance{Instance: instanceIdentity(s.Connection), Theme: appearance.Theme}) != nil {
		return
	}
	s.Theme = appearance.Theme
	h.Diagnostics.event("info", "appearance.changed", map[string]any{"theme": s.Theme})
}
