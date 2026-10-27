// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"archive/zip"
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

const diagnosticLogLimit int64 = 2 << 20

var credentialPattern = regexp.MustCompile(`(?i)((?:bearer|basic)\s+[^\s"<>]+|[a-f0-9]{64}|[a-z0-9_-]{12,}\.[a-z0-9_-]{12,}\.[a-z0-9_-]{12,})`)
var assignmentPattern = regexp.MustCompile(`(?i)\b(?:token|password|secret|authorization|api[_-]?key|signature)\b["' ]*\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)`)
var pathPattern = regexp.MustCompile(`(?i)(?:[a-z]:[\\/]|/Users/|/home/|/mnt/|/private/|/tmp/|/opt/)[^\r\n"<>]*`)
var addressPattern = regexp.MustCompile(`https?://[^\s"<>]+`)

func redactDiagnostic(value string) string {
	value = credentialPattern.ReplaceAllString(value, "[credential or digest redacted]")
	value = addressPattern.ReplaceAllStringFunc(value, func(raw string) string {
		parsed, e := url.Parse(raw)
		if e != nil {
			return "[URL redacted]"
		}
		parsed.User = nil
		parsed.RawQuery = ""
		parsed.Fragment = ""
		return parsed.String()
	})
	value = assignmentPattern.ReplaceAllString(value, "[credential redacted]")
	value = pathPattern.ReplaceAllString(value, "[local path redacted]")
	if len(value) > 4096 {
		value = value[:4096] + "…"
	}
	return value
}

func sanitizedDiagnosticValue(value any) any {
	data, e := json.Marshal(value)
	if e != nil {
		return "[unavailable]"
	}
	var decoded any
	if json.Unmarshal(data, &decoded) != nil {
		return "[unavailable]"
	}
	var clean func(any) any
	clean = func(value any) any {
		switch item := value.(type) {
		case string:
			return redactDiagnostic(item)
		case map[string]any:
			for key, field := range item {
				lower := strings.ToLower(key)
				if strings.Contains(lower, "token") || strings.Contains(lower, "password") || strings.Contains(lower, "authorization") || strings.Contains(lower, "secret") {
					item[key] = "[redacted]"
				} else {
					item[key] = clean(field)
				}
			}
			return item
		case []any:
			for i := range item {
				item[i] = clean(item[i])
			}
			return item
		default:
			return item
		}
	}
	return clean(decoded)
}

type bridgeDiagnostics struct {
	mu    sync.Mutex
	path  string
	file  *os.File
	bytes int64
}

func openBridgeDiagnostics(cache, role string) (*bridgeDiagnostics, error) {
	directory := filepath.Join(cache, "logs")
	if e := os.MkdirAll(directory, 0700); e != nil {
		return nil, e
	}
	if e := os.Chmod(directory, 0700); e != nil {
		return nil, e
	}
	d := &bridgeDiagnostics{path: filepath.Join(directory, "bridge-"+role+".jsonl")}
	if e := d.open(); e != nil {
		return nil, e
	}
	return d, nil
}
func (d *bridgeDiagnostics) open() error {
	file, e := os.OpenFile(d.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	if e = os.Chmod(d.path, 0600); e != nil {
		file.Close()
		return e
	}
	info, e := file.Stat()
	if e != nil {
		file.Close()
		return e
	}
	d.file = file
	d.bytes = info.Size()
	return nil
}
func (d *bridgeDiagnostics) close() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.file != nil {
		d.file.Close()
		d.file = nil
	}
}
func (d *bridgeDiagnostics) event(level, event string, fields map[string]any) {
	if d == nil {
		return
	}
	record := map[string]any{"timestamp": time.Now().UTC().Format(time.RFC3339Nano), "level": level, "event": event, "version": helperVersion}
	for key, value := range fields {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "token") || strings.Contains(lower, "password") || strings.Contains(lower, "authorization") {
			record[key] = "[redacted]"
			continue
		}
		if text, ok := value.(string); ok {
			record[key] = redactDiagnostic(text)
		} else {
			record[key] = value
		}
	}
	data, e := json.Marshal(sanitizedDiagnosticValue(record))
	if e != nil {
		return
	}
	if len(data) > 60000 {
		data, _ = json.Marshal(map[string]any{"timestamp": time.Now().UTC(), "level": "warning", "event": "diagnostic.record-too-large"})
	}
	data = append(data, '\n')
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.file == nil {
		return
	}
	if d.bytes+int64(len(data)) > diagnosticLogLimit {
		d.file.Close()
		d.file = nil
		_ = os.Remove(d.path + ".3")
		for i := 2; i >= 1; i-- {
			_ = os.Rename(fmt.Sprintf("%s.%d", d.path, i), fmt.Sprintf("%s.%d", d.path, i+1))
		}
		_ = os.Rename(d.path, d.path+".1")
		if d.open() != nil {
			return
		}
	}
	n, _ := d.file.Write(data)
	d.bytes += int64(n)
}

// Preserve important dependency errors without recording high-volume player packets.
type bridgeWarningWriter struct{ diagnostics *bridgeDiagnostics }

func (w bridgeWarningWriter) Write(data []byte) (int, error) {
	text := string(data)
	lower := strings.ToLower(text)
	for _, marker := range []string{"error", "failed", "fatal", "warning", "unable", "timeout"} {
		if strings.Contains(lower, marker) {
			w.diagnostics.event("warning", "engine.warning", map[string]any{"message": text})
			break
		}
	}
	return len(data), nil
}
func (h *helper) diagnosticRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		if h.Diagnostics == nil {
			jsonReply(w, 503, map[string]string{"error": "Diagnostic logging is unavailable. Check the Bridge cache directory permissions."})
			return
		}
		h.Diagnostics.event("info", "support.export", nil)
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="resonance-bridge-diagnostics.zip"`)
		archive := zip.NewWriter(w)
		defer archive.Close()
		summary := map[string]any{"application": "Resonance Bridge", "version": helperVersion, "os": runtime.GOOS, "arch": runtime.GOARCH, "exportedAt": time.Now().UTC(), "privacy": "Credentials, query strings and absolute local paths are removed. No connection files or music are included."}
		h.mu.Lock()
		summary["sharing"] = h.Session != nil
		summary["tracks"] = 0
		summary["paired"] = h.Sync != nil
		summary["applicationError"] = redactDiagnostic(h.Error)
		if h.Library != nil {
			summary["tracks"] = h.Library.Tracks
		}
		if h.Sync != nil {
			summary["syncStatus"] = redactDiagnostic(h.Sync.Status)
			summary["syncError"] = redactDiagnostic(h.Sync.Error)
		}
		h.mu.Unlock()
		if h.Updates != nil {
			summary["softwareUpdate"] = h.Updates.snapshot()
		}
		data, _ := json.MarshalIndent(sanitizedDiagnosticValue(summary), "", "  ")
		if entry, e := archive.Create("summary.json"); e == nil {
			entry.Write(data)
		}
		directory := filepath.Dir(h.Diagnostics.path)
		for _, role := range []string{"engine", "supervisor"} {
			for i := 0; i <= 3; i++ {
				name := "bridge-" + role + ".jsonl"
				if i > 0 {
					name += fmt.Sprintf(".%d", i)
				}
				path := filepath.Join(directory, name)
				before, statError := os.Lstat(path)
				if statError != nil || !before.Mode().IsRegular() {
					continue
				}
				file, e := os.Open(path)
				if e != nil {
					continue
				}
				after, statError := file.Stat()
				if statError != nil || !os.SameFile(before, after) {
					file.Close()
					continue
				}
				if entry, e := archive.Create(name); e == nil {
					scanner := bufio.NewScanner(io.LimitReader(file, diagnosticLogLimit))
					scanner.Buffer(make([]byte, 4096), 65536)
					for scanner.Scan() {
						var value any
						if json.Unmarshal(scanner.Bytes(), &value) == nil {
							data, _ := json.Marshal(sanitizedDiagnosticValue(value))
							entry.Write(append(data, '\n'))
						} else {
							entry.Write([]byte(redactDiagnostic(scanner.Text()) + "\n"))
						}
					}
				}
				file.Close()
			}
		}
	})
}
func installBridgeLog(d *bridgeDiagnostics) {
	if d != nil {
		log.SetOutput(io.MultiWriter(os.Stderr, bridgeWarningWriter{d}))
	}
}
