// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

const updateRestartCode = 75

func selectedEngine(cache string) (string, string, error) {
	data, e := os.ReadFile(filepath.Join(cache, "current-release.json"))
	if e != nil {
		return "", "", e
	}
	if len(data) > 32768 {
		return "", "", errors.New("release metadata exceeds limit")
	}
	var envelope signedRelease
	if e = json.Unmarshal(data, &envelope); e != nil {
		return "", "", e
	}
	r, e := verifyRelease(envelope, updatePublicKey)
	if e != nil {
		return "", "", e
	}
	if !newerVersion(r.Version, helperVersion) {
		return "", "", errors.New("selected update is not newer than the installed engine")
	}
	target := filepath.Join(cache, "updates", r.SHA256+engineExtension())
	f, e := os.Open(target)
	if e != nil {
		return "", "", e
	}
	defer f.Close()
	hash := sha256.New()
	n, e := io.Copy(hash, io.LimitReader(f, r.Size+1))
	if e != nil || n != r.Size || hex.EncodeToString(hash.Sum(nil)) != r.SHA256 {
		return "", "", errors.New("installed update failed integrity verification")
	}
	return target, r.Version, nil
}
func copyRelease(cache, from, to string) error {
	data, e := os.ReadFile(filepath.Join(cache, from))
	if e != nil {
		return e
	}
	var envelope signedRelease
	if e = json.Unmarshal(data, &envelope); e != nil {
		return e
	}
	if _, e = verifyRelease(envelope, updatePublicKey); e != nil {
		return e
	}
	return writePrivateJSON(filepath.Join(cache, to), envelope)
}
func rollbackRelease(cache string) {
	if e := copyRelease(cache, "last-good-release.json", "current-release.json"); e != nil {
		os.Remove(filepath.Join(cache, "current-release.json"))
	}
}
func supervise(cache, address string, args []string) int {
	installed, e := os.Executable()
	if e != nil {
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	for {
		target, version, selectionErr := selectedEngine(cache)
		updated := selectionErr == nil
		if !updated {
			target = installed
			version = helperVersion
		}
		childArgs := append([]string{"--engine"}, args...)
		cmd := exec.Command(target, childArgs...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Env = append(os.Environ(), "RESONANCE_HELPER_INSTALLED_ENGINE="+installed)
		if e = cmd.Start(); e != nil {
			if updated {
				rollbackRelease(cache)
				continue
			}
			return 1
		}
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		timer := time.NewTimer(20 * time.Second)
		poll := time.NewTicker(250 * time.Millisecond)
		healthy := false
		var childErr error
		finished := false
		for !finished {
			select {
			case <-ctx.Done():
				// Ask the loopback engine to drain ongoing work before forcing termination.
				client := &http.Client{Timeout: time.Second}
				req, _ := http.NewRequest("POST", "http://"+address+"/api/quit", nil)
				req.Header.Set("X-Resonance-Link", "1")
				if response, err := client.Do(req); err == nil {
					response.Body.Close()
				}
				select {
				case childErr = <-done:
				case <-time.After(15 * time.Second):
					cmd.Process.Kill()
					childErr = <-done
				}
				finished = true
			case childErr = <-done:
				finished = true
			case <-poll.C:
				if !healthy {
					client := &http.Client{Timeout: time.Second}
					response, err := client.Get("http://" + address + "/api/status")
					if err == nil {
						var status struct {
							Application string `json:"application"`
							Version     string `json:"version"`
						}
						err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&status)
						response.Body.Close()
						if err == nil && status.Application == "resonance-pioneer-link" && status.Version == version {
							healthy = true
							if updated {
								_ = copyRelease(cache, "current-release.json", "last-good-release.json")
							}
						}
					}
				}
			case <-timer.C:
				if !healthy && updated {
					cmd.Process.Kill()
					childErr = <-done
					finished = true
				}
			}
		}
		timer.Stop()
		poll.Stop()
		if ctx.Err() != nil {
			return 0
		}
		var exit *exec.ExitError
		if errors.As(childErr, &exit) && exit.ExitCode() == updateRestartCode {
			args = append([]string{"--no-open"}, args...)
			continue
		}
		if updated && !healthy && childErr != nil {
			// Never keep retrying a failed version after falling back to it.
			data, _ := os.ReadFile(filepath.Join(cache, "current-release.json"))
			var rejected signedRelease
			if json.Unmarshal(data, &rejected) == nil {
				_ = writePrivateJSON(filepath.Join(cache, "rejected-release.json"), rejected)
			}
			rollbackRelease(cache)
			after, _ := os.ReadFile(filepath.Join(cache, "current-release.json"))
			if string(data) == string(after) {
				os.Remove(filepath.Join(cache, "current-release.json"))
			}
			fmt.Fprintln(os.Stderr, "Helper update failed to start; restored the previous engine")
			continue
		}
		if childErr != nil {
			return 1
		}
		return 0
	}
}
