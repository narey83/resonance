// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

var handoffContext = []byte("resonance-bridge-handoff-v1")

func (h *helper) handoffKeyPath() string {
	return filepath.Join(filepath.Dir(h.pairingPath()), "handoff-key.json")
}

// Rotate the private key only after this process has acquired the listening port.
func (h *helper) initializeHandoffKey() error {
	key := make([]byte, 32)
	if _, e := rand.Read(key); e != nil {
		return e
	}
	dir := filepath.Dir(h.handoffKeyPath())
	if e := os.MkdirAll(dir, 0700); e != nil {
		return e
	}
	if e := os.Chmod(dir, 0700); e != nil {
		return e
	}
	if e := writePrivateJSON(h.handoffKeyPath(), key); e != nil {
		return e
	}
	h.HandoffKey = key
	return nil
}

func handoffCipher(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, errors.New("restart Bridge to enable private handoffs")
	}
	block, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	return cipher.NewGCM(block)
}

func sealHandoff(key, data []byte) ([]byte, error) {
	gcm, e := handoffCipher(key)
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return nil, e
	}
	return gcm.Seal(nonce, nonce, data, handoffContext), nil
}

func openHandoff(key, data []byte) ([]byte, error) {
	gcm, e := handoffCipher(key)
	if e != nil {
		return nil, e
	}
	if len(data) < gcm.NonceSize()+gcm.Overhead() {
		return nil, errors.New("invalid private handoff")
	}
	return gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], handoffContext)
}

func (h *helper) sealLocalHandoff(data []byte) ([]byte, error) {
	file, e := os.ReadFile(h.handoffKeyPath())
	if e != nil {
		return nil, errors.New("restart Bridge to enable private handoffs")
	}
	var key []byte
	if e = json.Unmarshal(file, &key); e != nil {
		return nil, e
	}
	return sealHandoff(key, data)
}
