// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestLocalHandoffEncryptsCredentialsAndRejectsOtherKeys(t *testing.T) {
	h := &helper{Cache: t.TempDir()}
	if e := h.initializeHandoffKey(); e != nil {
		t.Fatal(e)
	}
	data := []byte("{\"token\":\"synthetic-private-handoff\"}")
	sealed, e := h.sealLocalHandoff(data)
	if e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(sealed, []byte("synthetic-private-handoff")) {
		t.Fatal("bearer credential present in transmitted body")
	}
	opened, e := openHandoff(h.HandoffKey, sealed)
	if e != nil || !bytes.Equal(opened, data) {
		t.Fatalf("handoff round trip failed: %v", e)
	}
	second := &helper{Cache: t.TempDir()}
	if e = second.initializeHandoffKey(); e != nil {
		t.Fatal(e)
	}
	if _, e = openHandoff(second.HandoffKey, sealed); e == nil {
		t.Fatal("a different local user's key decrypted the handoff")
	}
	sealed[len(sealed)-1] ^= 1
	if _, e = openHandoff(h.HandoffKey, sealed); e == nil {
		t.Fatal("modified handoff was accepted")
	}
	if info, e := os.Stat(h.handoffKeyPath()); e != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("private key permissions: %v", e)
	}
}

func TestLocalHandoffRotationAndPlaintextRejection(t *testing.T) {
	h := &helper{Cache: t.TempDir()}
	if e := h.initializeHandoffKey(); e != nil {
		t.Fatal(e)
	}
	sealed, e := h.sealLocalHandoff([]byte("{}"))
	if e != nil {
		t.Fatal(e)
	}
	if e = h.initializeHandoffKey(); e != nil {
		t.Fatal(e)
	}
	if _, e = openHandoff(h.HandoffKey, sealed); e == nil {
		t.Fatal("prior engine's handoff remained usable")
	}
	mux := http.NewServeMux()
	h.handoffRoutes(mux)
	request := httptest.NewRequest("POST", "/api/handoff", bytes.NewBufferString("{\"token\":\"synthetic\"}"))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != 400 {
		t.Fatalf("plaintext handoff status %d", response.Code)
	}
}

// Produced by CryptoKit AES.GCM.seal using the macOS launcher's envelope and context.
func TestCryptoKitHandoffInteroperability(t *testing.T) {
	sealed, e := base64.StdEncoding.DecodeString("AgICAgICAgICAgICdK+nPSIytZSw4cy6NdGjxseYuY6F1eIXu+SYQ3SwCa/wkLW0eRP8+1Q=")
	if e != nil {
		t.Fatal(e)
	}
	data, e := openHandoff(bytes.Repeat([]byte{1}, 32), sealed)
	if e != nil || string(data) != "synthetic-private-handoff" {
		t.Fatalf("CryptoKit handoff failed: %v", e)
	}
}
