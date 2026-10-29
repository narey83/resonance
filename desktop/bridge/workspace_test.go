// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func workspaceHelper(t *testing.T) *helper {
	t.Helper()
	_, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return &helper{Cache: t.TempDir(), Sync: &synchronization{Connection: connection{SchemaVersion: 1, ServerURL: "https://resonance.test/music/api/v0/bridge/sync", Expires: time.Now().Add(time.Hour)}, Cancel: cancel}}
}
func workspaceRequest(h *helper, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:55460"+path, strings.NewReader(body))
	r.Header.Set("X-Resonance-Link", "1")
	w := httptest.NewRecorder()
	h.routes("127.0.0.1:55460").ServeHTTP(w, r)
	return w
}
func TestWorkspaceRequiresPairingAndKeepsSettingsAvailable(t *testing.T) {
	for _, expired := range []bool{false, true} {
		h := &helper{Cache: t.TempDir()}
		if expired {
			h = workspaceHelper(t)
			h.Sync.Connection.Expires = time.Now().Add(-time.Minute)
		}
		for _, path := range []string{"/", "/usb"} {
			w := workspaceRequest(h, "GET", path, "")
			if w.Code != 303 || !strings.HasPrefix(w.Header().Get("Location"), "/settings?") {
				t.Fatal("unpaired feature page was accessible", path, w.Code)
			}
		}
		for _, path := range []string{"/api/start", "/api/usb/write", "/api/usb/receive", "/api/usb/eject"} {
			w := workspaceRequest(h, "POST", path, "{}")
			if w.Code != 409 {
				t.Fatal("unpaired feature action was accessible", path, w.Code)
			}
		}
		for _, path := range []string{"/settings", "/assets/bridge.css", "/assets/bridge.js", "/api/status"} {
			w := workspaceRequest(h, "GET", path, "")
			if w.Code != 200 {
				t.Fatal("setup resource unavailable", path, w.Code)
			}
		}
	}
}
func TestPairedWorkspaceHasThreePagesAndOneSettingsPairingFlow(t *testing.T) {
	h := workspaceHelper(t)
	for _, path := range []string{"/", "/usb", "/settings"} {
		w := workspaceRequest(h, "GET", path, "")
		if w.Code != 200 {
			t.Fatal(path, w.Code)
		}
		body := w.Body.String()
		if !strings.Contains(body, `data-page="settings"`) || !strings.Contains(body, `data-nav="usb"`) {
			t.Fatal("shared navigation missing")
		}
	}
	w := workspaceRequest(h, "GET", "/api/status", "")
	var view map[string]any
	if e := json.Unmarshal(w.Body.Bytes(), &view); e != nil {
		t.Fatal(e)
	}
	if view["paired"] != true {
		t.Fatal("pairing state not exposed")
	}
	h.syncState(h.Sync, "Reconnect", errPairingRejected)
	w = workspaceRequest(h, "GET", "/usb", "")
	if w.Code != 303 {
		t.Fatal("revoked pairing still unlocks workspace")
	}
}
func TestUSBExportsStayScopedToThePairedInstance(t *testing.T) {
	h := workspaceHelper(t)
	usb := connection{SchemaVersion: 1, ServerURL: "https://other.test/music/api/v0/analysis/usb-export/transfer/" + strings.Repeat("a", 32), Token: strings.Repeat("b", 64), Expires: time.Now().Add(time.Hour)}
	if e := h.receiveUSB(usb); e == nil || !strings.Contains(e.Error(), "different Resonance instance") {
		t.Fatal("unrelated instance export accepted")
	}
	if h.USB != nil {
		t.Fatal("mismatched export started a transfer")
	}
	if e := h.connect(usb); e == nil {
		t.Fatal("USB handoff accepted as permanent pairing")
	}
	for _, pair := range [][2]string{{"https://resonance.test/music/api/v0/bridge/sync", "https://resonance.test:443/music/api/v0/analysis/usb-export/transfer/job"}, {"https://resonance.test/api/v0/analysis/pioneer-link/sync", "https://resonance.test/api/v0/analysis/usb-export/transfer/job"}} {
		if !sameInstance(connection{ServerURL: pair[0]}, connection{ServerURL: pair[1]}) {
			t.Fatal("matching instance was rejected")
		}
	}
	if sameInstance(h.Sync.Connection, connection{ServerURL: "https://resonance.test/another/api/v0/analysis/usb-export/transfer/job"}) {
		t.Fatal("different application base path accepted")
	}
}
func TestPairingCannotChangeDuringTransfer(t *testing.T) {
	h := workspaceHelper(t)
	h.USB = &usbTransfer{Status: "writing"}
	original := h.Sync
	if e := h.disconnect(); e == nil {
		t.Fatal("pairing forgotten during USB write")
	}
	if h.Sync != original {
		t.Fatal("active pairing changed")
	}
	c := h.Sync.Connection
	c.Token = strings.Repeat("a", 64)
	if e := h.connect(c); e == nil {
		t.Fatal("pairing replaced during USB write")
	}
}
