// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestAppearanceValidatesCachesAndKeepsLastThemeOffline(t *testing.T) {
	reply := `{"theme":"midnight"}`
	code := 200
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v0/bridge/appearance" || r.Header.Get("X-Resonance-Link-Token") != "pairing-token" {
			t.Error("appearance used wrong route or authentication")
		}
		w.WriteHeader(code)
		w.Write([]byte(reply))
	}))
	defer server.Close()
	c := connection{ServerURL: server.URL + "/api/v0/bridge/sync", Token: "pairing-token", Expires: time.Now().Add(time.Hour)}
	h := &helper{Cache: t.TempDir()}
	s := &synchronization{Connection: c}
	h.Sync = s
	h.refreshAppearance(context.Background(), server.Client(), s)
	if s.Theme != "midnight" || h.savedAppearance(c) != "midnight" {
		t.Fatal("theme was not cached")
	}
	if h.savedAppearance(connection{ServerURL: "https://different.test/api/v0/bridge/sync"}) != "" {
		t.Fatal("other instance inherited theme")
	}
	for _, bad := range []string{`{"theme":"url(https://evil.test)"}`, `{"theme":42}`, `{"theme":"MIDNIGHT"}`, "invalid"} {
		reply = bad
		h.refreshAppearance(context.Background(), server.Client(), s)
		if s.Theme != "midnight" {
			t.Fatal("untrusted theme was accepted")
		}
	}
	reply = `{"theme":"ember"}`
	code = 401
	h.refreshAppearance(context.Background(), server.Client(), s)
	if s.Theme != "midnight" {
		t.Fatal("unauthorized response replaced cached theme")
	}
	code = 200
	s.Rejected = true
	h.refreshAppearance(context.Background(), server.Client(), s)
	if s.Theme != "midnight" {
		t.Fatal("revoked pairing updated theme")
	}
	s.Rejected = false
	h.Sync = &synchronization{}
	h.refreshAppearance(context.Background(), server.Client(), s)
	if h.savedAppearance(c) != "midnight" {
		t.Fatal("replaced pairing updated cache")
	}
	if data, _ := os.ReadFile(h.appearancePath()); string(data) == "" {
		t.Fatal("no persistent cache")
	}
}

func TestAppearanceNeverFollowsRedirectsWithCredentials(t *testing.T) {
	contacted := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { contacted = true }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 302) }))
	defer server.Close()
	h := &helper{Cache: t.TempDir()}
	s := &synchronization{Connection: connection{ServerURL: server.URL + "/api/v0/bridge/sync", Token: "secret"}}
	h.Sync = s
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	h.refreshAppearance(context.Background(), client, s)
	if contacted || s.Theme != "" {
		t.Fatal("appearance redirect was followed")
	}
}
