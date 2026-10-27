// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"errors"
	"net"
	"net/url"
	"strings"
	"time"
)

var errPairingRejected = errors.New("connection expired or revoked; download a new connection file in Resonance")

// Pairing is shared by the workspace, while each server operation still checks its own credentials.
func (h *helper) pairedLocked() bool {
	return h.Sync != nil && !h.Sync.Rejected && h.Sync.Connection.Expires.After(time.Now())
}
func (h *helper) isPaired() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.pairedLocked() }
func instanceIdentity(c connection) string {
	parsed, e := url.Parse(c.ServerURL)
	if e != nil || parsed.User != nil || parsed.Hostname() == "" {
		return ""
	}
	at := strings.LastIndex(parsed.Path, "/api/")
	if at < 0 {
		return ""
	}
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "https" {
			port = "443"
		} else if parsed.Scheme == "http" {
			port = "80"
		} else {
			return ""
		}
	}
	return parsed.Scheme + "://" + net.JoinHostPort(strings.ToLower(parsed.Hostname()), port) + parsed.Path[:at]
}
func sameInstance(pairing, export connection) bool {
	base := instanceIdentity(pairing)
	return base != "" && base == instanceIdentity(export)
}
