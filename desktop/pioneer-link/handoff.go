// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"net/http"
)

func documentView(c *connection) string {
	if c != nil && isUSB(*c) {
		return "/usb"
	}
	return "/"
}
func (h *helper) handoffRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/handoff", func(w http.ResponseWriter, r *http.Request) {
		var c connection
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536)).Decode(&c) != nil {
			jsonReply(w, 400, map[string]string{"error": "invalid Resonance handoff file"})
			return
		}
		var e error
		if isUSB(c) {
			e = h.receiveUSB(c)
		} else {
			h.operation.Lock()
			e = h.connect(c)
			h.operation.Unlock()
		}
		if e != nil {
			jsonReply(w, 409, map[string]string{"error": e.Error()})
			return
		}
		jsonReply(w, 200, map[string]string{"openPath": documentView(&c)})
	})
}
