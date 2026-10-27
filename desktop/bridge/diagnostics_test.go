// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDiagnosticsRedactsCredentialsAndPaths(t *testing.T) {
	secret := strings.Repeat("a", 64)
	value := `https://user:pass@example.test/api?token=short-secret Bearer jwt-secret password="private password" /Users/test/Music/private track.wav`
	got := redactDiagnostic(value + " " + secret)
	for _, private := range []string{"user:pass", "short-secret", "jwt-secret", "private password", "private track.wav", secret} {
		if strings.Contains(got, private) {
			t.Fatal("diagnostic leaked private information")
		}
	}
	valueJSON, _ := json.Marshal(sanitizedDiagnosticValue(map[string]any{"details": map[string]any{"token": "nested-secret"}, "update": updateView{Error: "open /home/test/private/file: denied"}}))
	if strings.Contains(string(valueJSON), "nested-secret") || strings.Contains(string(valueJSON), "/home/test") {
		t.Fatal(string(valueJSON))
	}
}
func TestDiagnosticRotationIsBounded(t *testing.T) {
	cache := t.TempDir()
	d, e := openBridgeDiagnostics(cache, "engine")
	if e != nil {
		t.Fatal(e)
	}
	defer d.close()
	for i := 0; i < 2500; i++ {
		d.event("info", "test.rotation", map[string]any{"message": strings.Repeat("x", 4000)})
	}
	files, e := os.ReadDir(filepath.Join(cache, "logs"))
	if e != nil {
		t.Fatal(e)
	}
	if len(files) > 4 {
		t.Fatal("unbounded log rotation")
	}
	for _, file := range files {
		info, _ := file.Info()
		if info.Size() > diagnosticLogLimit {
			t.Fatal("oversized log")
		}
	}
}
func TestDiagnosticExportRequiresTrustedActionAndExcludesConnections(t *testing.T) {
	cache := t.TempDir()
	d, e := openBridgeDiagnostics(cache, "engine")
	if e != nil {
		t.Fatal(e)
	}
	defer d.close()
	os.WriteFile(filepath.Join(cache, "connection.json"), []byte("private connection token"), 0600)
	os.WriteFile(filepath.Join(cache, "logs", "bridge-supervisor.jsonl"), []byte("password=from-older-log\n"), 0600)
	d.event("warning", "connection.failed", map[string]any{"token": "private connection token", "message": "server returned HTTP 503"})
	h := (&helper{Cache: cache, Diagnostics: d, Updates: newUpdater()}).routes("127.0.0.1:55460")
	for _, origin := range []string{"https://untrusted.example", ""} {
		request := httptest.NewRequest("POST", "http://127.0.0.1:55460/api/diagnostics", nil)
		if origin != "" {
			request.Header.Set("Origin", origin)
			request.Header.Set("X-Resonance-Link", "1")
		}
		response := httptest.NewRecorder()
		h.ServeHTTP(response, request)
		if response.Code != 403 {
			t.Fatal(response.Code)
		}
	}
	request := httptest.NewRequest("POST", "http://127.0.0.1:55460/api/diagnostics", nil)
	request.Header.Set("X-Resonance-Link", "1")
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatal(response.Code)
	}
	archive, e := zip.NewReader(bytes.NewReader(response.Body.Bytes()), int64(response.Body.Len()))
	if e != nil {
		t.Fatal(e)
	}
	for _, file := range archive.File {
		if file.Name == "connection.json" {
			t.Fatal("connection included")
		}
		reader, _ := file.Open()
		data, _ := io.ReadAll(reader)
		reader.Close()
		if strings.Contains(string(data), "private connection token") || strings.Contains(string(data), "from-older-log") {
			t.Fatal("secret leaked")
		}
	}
}
