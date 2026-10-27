// SPDX-License-Identifier: AGPL-3.0-only
// helper-release generates release keys or signs engine releases. Private keys never enter archives.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run() error {
	generate := flag.Bool("generate-key", false, "generate a new Ed25519 release key; never overwrite")
	keyPath := flag.String("key", "", "private key file (base64 Ed25519 key)")
	binary := flag.String("binary", "", "engine executable to publish")
	version := flag.String("version", "", "major.minor.patch release version")
	goos := flag.String("os", "", "darwin, windows or linux")
	arch := flag.String("arch", "", "arm64 or amd64")
	output := flag.String("output", "", "release output directory")
	flag.Parse()
	if *keyPath == "" {
		return errors.New("--key is required")
	}
	if *generate {
		public, private, e := ed25519.GenerateKey(rand.Reader)
		if e != nil {
			return e
		}
		file, e := os.OpenFile(*keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return e
		}
		_, e = file.WriteString(base64.StdEncoding.EncodeToString(private))
		closeErr := file.Close()
		if e != nil {
			return e
		}
		if closeErr != nil {
			return closeErr
		}
		return os.WriteFile(*keyPath+".pub", []byte(base64.StdEncoding.EncodeToString(public)), 0644)
	}
	if *goos != "darwin" && *goos != "windows" && *goos != "linux" {
		return errors.New("invalid --os")
	}
	if *arch != "arm64" && *arch != "amd64" {
		return errors.New("invalid --arch")
	}
	if !regexp.MustCompile(`^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$`).MatchString(*version) {
		return errors.New("invalid --version")
	}
	if *binary == "" || *output == "" {
		return errors.New("--binary and --output are required")
	}
	keyData, e := os.ReadFile(*keyPath)
	if e != nil {
		return e
	}
	private, e := base64.StdEncoding.DecodeString(string(keyData))
	if e != nil || len(private) != ed25519.PrivateKeySize {
		return errors.New("invalid private signing key")
	}
	body, e := os.ReadFile(*binary)
	if e != nil {
		return e
	}
	if len(body) == 0 || len(body) > 128<<20 {
		return errors.New("engine size exceeds update bounds")
	}
	digest := sha256.Sum256(body)
	hash := hex.EncodeToString(digest[:])
	payload, e := json.Marshal(map[string]any{"version": *version, "os": *goos, "arch": *arch, "size": len(body), "sha256": hash, "protocol": 1})
	if e != nil {
		return e
	}
	envelope, e := json.Marshal(map[string]string{"payload": base64.StdEncoding.EncodeToString(payload), "signature": base64.StdEncoding.EncodeToString(ed25519.Sign(private, payload))})
	if e != nil {
		return e
	}
	if e = os.MkdirAll(*output, 0755); e != nil {
		return e
	}
	if e = os.WriteFile(filepath.Join(*output, hash+".bin"), body, 0644); e != nil {
		return e
	}
	// Publish immutable binary before atomically replacing discovery metadata.
	file, e := os.CreateTemp(*output, ".release-*")
	if e != nil {
		return e
	}
	defer os.Remove(file.Name())
	if _, e = file.Write(envelope); e == nil {
		e = file.Sync()
	}
	closeErr := file.Close()
	if e == nil {
		e = closeErr
	}
	if e != nil {
		return e
	}
	if e = os.Chmod(file.Name(), 0644); e != nil {
		return e
	}
	return os.Rename(file.Name(), filepath.Join(*output, *goos+"-"+*arch+".json"))
}
