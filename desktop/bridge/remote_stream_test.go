// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestResonanceStreamReaderUsesAuthenticatedRangesWithoutFiles(t *testing.T) {
	secret := strings.Repeat("a", 64)
	source := strings.Repeat("b", 64)
	audio := []byte("0123456789abcdef")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v0/bridge/sync/audio/"+source || r.Header.Get("X-Resonance-Link-Token") != secret || r.Header.Get("Range") != "bytes=4-9" {
			t.Fatalf("unexpected stream request: %s %q", r.URL.Path, r.Header.Get("Range"))
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 4-9/%d", len(audio)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(audio[4:10])
	}))
	defer server.Close()

	virtual := filepath.Join(t.TempDir(), "Contents", "track.mp3")
	reader := newResonanceStreamReader(connection{ServerURL: server.URL + "/api/v0/bridge/sync", Token: secret}, map[string]remoteFile{
		virtual: {SourceKey: source, SHA256: strings.Repeat("c", 64), Bytes: int64(len(audio))},
	})
	data, err := reader.ReadAt(virtual, 4, 6)
	if err != nil || string(data) != "456789" {
		t.Fatal(string(data), err)
	}
	if size, _, ok := reader.Stat(virtual); !ok || size != int64(len(audio)) {
		t.Fatal("virtual stream stat unavailable")
	}
}
