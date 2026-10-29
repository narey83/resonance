// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type startupSettings struct {
	Enabled bool `json:"enabled"`
}

func startupEnabled(cache string) bool {
	data, e := os.ReadFile(filepath.Join(cache, "startup.json"))
	if e != nil {
		return true
	}
	var value startupSettings
	return json.Unmarshal(data, &value) == nil && value.Enabled
}
func escapeXML(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}
func linuxExec(path string) string {
	// Desktop-entry quoted arguments have an additional escaping layer, and % is a field code.
	r := strings.NewReplacer("\\", "\\\\\\\\", "\"", "\\\\\"", "`", "\\\\`", "$", "\\\\$", "%", "%%")
	return "\"" + r.Replace(path) + "\""
}
func startupEntry(goos, executable, home, config string) (string, []byte, error) {
	if strings.ContainsAny(executable, "\n\r") {
		return "", nil, errors.New("executable path contains an unsupported line break")
	}
	switch goos {
	case "darwin":
		app := os.Getenv("RESONANCE_HELPER_APP")
		if app == "" {
			return "", nil, errors.New("launch the installed macOS app to enable sign-in startup")
		}
		path := filepath.Join(home, "Library", "LaunchAgents", "app.resonance.bridge.plist")
		body := `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>app.resonance.bridge</string><key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>` + escapeXML(app) + `</string><string>--args</string><string>--no-open</string></array><key>RunAtLoad</key><true/></dict></plist>`
		return path, []byte(body), nil
	case "linux":
		path := filepath.Join(config, "autostart", "resonance-bridge.desktop")
		return path, []byte("[Desktop Entry]\nType=Application\nName=Resonance Bridge\nExec=" + linuxExec(executable) + " --no-open\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"), nil
	case "windows":
		return windowsStartupEntry(executable)
	}
	return "", nil, errors.New("sign-in startup is unsupported on this platform")
}
func configureStartup(cache string, enabled bool) error {
	executable := os.Getenv("RESONANCE_HELPER_INSTALLED_ENGINE")
	if executable == "" {
		var e error
		executable, e = os.Executable()
		if e != nil {
			return e
		}
	}
	if runtime.GOOS == "windows" {
		if e := configureWindowsStartup(executable, enabled); e != nil {
			return e
		}
		return writePrivateJSON(filepath.Join(cache, "startup.json"), startupSettings{enabled})
	}
	home, e := os.UserHomeDir()
	if e != nil {
		return e
	}
	config, e := os.UserConfigDir()
	if e != nil {
		return e
	}
	path, data, e := startupEntry(runtime.GOOS, executable, home, config)
	if e != nil {
		return e
	}
	if enabled {
		if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
			return e
		}
		if e = os.WriteFile(path, data, 0600); e != nil {
			return e
		}
	} else if e = os.Remove(path); e != nil && !os.IsNotExist(e) {
		return e
	}
	legacy := ""
	if runtime.GOOS == "darwin" {
		legacy = filepath.Join(home, "Library", "LaunchAgents", "app.resonance.pioneer-link.plist")
	} else if runtime.GOOS == "linux" {
		legacy = filepath.Join(config, "autostart", "resonance-pioneer-link.desktop")
	}
	if legacy != "" {
		_ = os.Remove(legacy)
	}
	return writePrivateJSON(filepath.Join(cache, "startup.json"), startupSettings{enabled})
}
func (h *helper) desktopRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/desktop", func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		startupError := h.StartupError
		running := h.Session != nil
		busy := h.busyForUpdate()
		h.mu.Unlock()
		update := updateView{Version: helperVersion, Status: "Not initialized"}
		if h.Updates != nil {
			update = h.Updates.snapshot()
		}
		jsonReply(w, 200, map[string]any{"startup": startupEnabled(h.Cache), "update": update, "startupError": startupError, "running": running, "busy": busy})
	})
	mux.HandleFunc("POST /api/desktop/startup", func(w http.ResponseWriter, r *http.Request) {
		h.operation.Lock()
		defer h.operation.Unlock()
		var value startupSettings
		if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&value); e != nil {
			jsonReply(w, 400, map[string]string{"error": "invalid startup preference"})
			return
		}
		if e := configureStartup(h.Cache, value.Enabled); e != nil {
			jsonReply(w, 409, map[string]string{"error": fmt.Sprint(e)})
			return
		}
		jsonReply(w, 200, value)
	})
	mux.HandleFunc("POST /api/desktop/check-update", func(w http.ResponseWriter, r *http.Request) {
		if h.Updates != nil {
			h.Updates.check()
		}
		jsonReply(w, 202, map[string]bool{"checking": true})
	})
}
