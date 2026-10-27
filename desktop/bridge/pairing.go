// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
)

func (h *helper) pairingPath() string {
	root := h.PairingDirectory
	if root == "" {
		root = h.Cache
	}
	return filepath.Join(root, "connection.json")
}
func (h *helper) savePairing(c connection) error {
	root := filepath.Dir(h.pairingPath())
	if e := os.MkdirAll(root, 0700); e != nil {
		return e
	}
	if e := os.Chmod(root, 0700); e != nil {
		return e
	}
	return writePrivateJSON(h.pairingPath(), c)
}

// Load the durable pairing first. A legacy cache copy is migrated only when absent.
func (h *helper) loadPairing() (connection, error) {
	var c connection
	path := h.pairingPath()
	file, e := os.Open(path)
	if errors.Is(e, os.ErrNotExist) && path != filepath.Join(h.Cache, "connection.json") {
		file, e = os.Open(filepath.Join(h.Cache, "connection.json"))
	}
	if e != nil {
		return c, e
	}
	defer file.Close()
	data, e := io.ReadAll(io.LimitReader(file, 65537))
	if e != nil {
		return c, e
	}
	if len(data) > 65536 {
		return c, errors.New("saved pairing file is too large")
	}
	if e = json.Unmarshal(data, &c); e != nil {
		return c, errors.New("saved pairing file is unreadable; download a new Bridge connection in Resonance")
	}
	return c, nil
}
func (h *helper) restorePairing() {
	c, e := h.loadPairing()
	if errors.Is(e, os.ErrNotExist) {
		return
	}
	if e == nil {
		e = h.connect(c)
	}
	if e != nil {
		h.mu.Lock()
		h.Error = "Could not restore the saved pairing: " + redactDiagnostic(e.Error())
		h.mu.Unlock()
		h.Diagnostics.event("warning", "connection.restore-failed", map[string]any{"error": e.Error()})
		return
	}
	h.Diagnostics.event("info", "connection.restored", nil)
}
