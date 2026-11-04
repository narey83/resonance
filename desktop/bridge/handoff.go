// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"io"
	"net/http"
)

func documentView(c *connection) string {
	if c != nil && isUSB(*c) {
		return "/usb"
	}
	if c != nil {
		return "/settings"
	}
	return "/"
}
func (h *helper) handoffRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/handoff", func(w http.ResponseWriter, r *http.Request) {
		sealed, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 65536+64))
		var data []byte
		if e == nil {
			data, e = openHandoff(h.HandoffKey, sealed)
		}
		var c connection
		if e != nil || json.Unmarshal(data, &c) != nil {
			jsonReply(w, 400, map[string]string{"error": "Update and restart the Bridge app to use private handoffs."})
			return
		}
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
