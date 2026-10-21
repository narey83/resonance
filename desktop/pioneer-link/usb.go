// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type usbTransfer struct {
	Done        chan struct{}      `json:"-"`
	Status      string             `json:"status"`
	Error       string             `json:"error"`
	Name        string             `json:"name"`
	Tracks      int                `json:"tracks"`
	Destination string             `json:"destination,omitempty"`
	Prepared    int                `json:"prepared"`
	Total       int                `json:"total"`
	Bundle      *bundle            `json:"-"`
	Cancel      context.CancelFunc `json:"-"`
}

func isUSB(c connection) bool {
	parts := strings.Split(c.ServerURL, "/analysis/usb-export/transfer/")
	if len(parts) != 2 || len(parts[1]) != 32 {
		return false
	}
	_, e := hex.DecodeString(parts[1])
	return e == nil
}
func (h *helper) receiveUSB(c connection) error {
	if e := validateConnection(c); e != nil {
		return e
	}
	if !isUSB(c) {
		return errors.New("select a USB export handoff file")
	}
	h.mu.Lock()
	if h.USB != nil && (h.USB.Status == "downloading" || h.USB.Status == "writing") {
		h.mu.Unlock()
		return errors.New("finish or cancel the current USB transfer first")
	}
	old := h.USB
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	u := &usbTransfer{Status: "downloading", Cancel: cancel, Done: make(chan struct{})}
	h.USB = u
	h.mu.Unlock()
	if old != nil && old.Bundle != nil {
		os.RemoveAll(old.Bundle.Root)
	}
	go func() {
		defer close(u.Done)
		defer cancel()
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("export download redirects are not allowed")
		}}
		response, e := fetchSync(ctx, client, c, "")
		if e != nil {
			h.usbError(u, e)
			return
		}
		defer response.Body.Close()
		f, e := os.CreateTemp(h.Cache, "usb-*.zip")
		if e != nil {
			h.usbError(u, e)
			return
		}
		defer os.Remove(f.Name())
		n, e := io.Copy(f, io.LimitReader(response.Body, maxBundleBytes+1))
		f.Close()
		if e != nil || n > maxBundleBytes {
			if e == nil {
				e = errors.New("USB export exceeds 50 GiB")
			}
			h.usbError(u, e)
			return
		}
		b, e := importBundle(f.Name(), h.Cache)
		if e != nil {
			h.usbError(u, e)
			return
		}
		h.mu.Lock()
		if h.USB != u || ctx.Err() != nil {
			if h.USB == u {
				u.Status = "failed"
				u.Error = "Export download cancelled"
			}
			h.mu.Unlock()
			os.RemoveAll(b.Root)
			return
		}
		u.Bundle = b
		u.Status = "ready"
		u.Name = b.Name
		u.Tracks = b.Tracks
		h.mu.Unlock()
	}()
	return nil
}
func (h *helper) usbError(u *usbTransfer, e error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.USB == u {
		u.Status = "failed"
		u.Error = e.Error()
	}
}
func destinationReady(target string) error {
	info, e := os.Lstat(target)
	if e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("destination must be an existing mounted directory")
	}
	real, e := filepath.EvalSymlinks(target)
	if e != nil {
		return e
	}
	absolute, _ := filepath.Abs(target)
	if real != absolute {
		return errors.New("destination cannot contain symlinks")
	}
	home, _ := os.UserHomeDir()
	if real == home || (runtime.GOOS != "windows" && real == string(filepath.Separator)) || (runtime.GOOS == "windows" && strings.EqualFold(filepath.VolumeName(real), os.Getenv("SystemDrive"))) {
		return errors.New("system roots and home directories cannot be USB destinations")
	}
	entries, e := os.ReadDir(target)
	if e != nil {
		return e
	}
	allowed := map[string]bool{".spotlight-v100": true, ".trashes": true, ".fseventsd": true, ".ds_store": true, "system volume information": true, "$recycle.bin": true, ".temporaryitems": true, ".volumeicon.icns": true}
	for _, entry := range entries {
		if !allowed[strings.ToLower(entry.Name())] {
			return errors.New("use an empty USB drive; existing files are never replaced")
		}
	}
	return nil
}
func writeUSB(ctx context.Context, b *bundle, target string, verifyMount func() error, progress func(int, int)) (err error) {
	if e := destinationReady(target); e != nil {
		return e
	}
	if verifyMount != nil {
		if e := verifyMount(); e != nil {
			return e
		}
	}
	data, e := os.ReadFile(filepath.Join(b.Root, "export-manifest.json"))
	if e != nil {
		return e
	}
	var manifest exportManifest
	if e = json.Unmarshal(data, &manifest); e != nil {
		return e
	}
	var bytes uint64
	for _, spec := range manifest.Files {
		if spec.Bytes < 0 {
			return errors.New("invalid export size")
		}
		bytes += uint64(spec.Bytes)
	}
	free, e := freeBytes(target)
	if e != nil {
		return e
	}
	if free < bytes+16*1024*1024 {
		return errors.New("not enough free space on this drive")
	}
	stage, e := os.MkdirTemp(target, ".resonance-usb-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(stage)
	published := []string{}
	defer func() {
		if err != nil {
			for i := len(published) - 1; i >= 0; i-- {
				os.RemoveAll(published[i])
			}
		}
	}()
	copyFile := func(relative string, spec *fileSpec) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		if _, e := safeName(relative); e != nil {
			return e
		}
		source := filepath.Join(b.Root, filepath.FromSlash(relative))
		if e := requireUnder(b.Root, source); e != nil {
			return e
		}
		dest := filepath.Join(stage, filepath.FromSlash(relative))
		if e := os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
			return e
		}
		in, e := os.Open(source)
		if e != nil {
			return e
		}
		defer in.Close()
		out, e := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return e
		}
		digest := sha256.New()
		var written int64
		buf := make([]byte, 1<<20)
		for {
			if e = ctx.Err(); e != nil {
				break
			}
			n, readErr := in.Read(buf)
			if n > 0 {
				count, writeErr := out.Write(buf[:n])
				digest.Write(buf[:count])
				written += int64(count)
				if writeErr != nil {
					e = writeErr
					break
				}
				if count != n {
					e = io.ErrShortWrite
					break
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				e = readErr
				break
			}
		}
		if e == nil {
			e = out.Sync()
		}
		closeErr := out.Close()
		if e != nil {
			return e
		}
		if closeErr != nil {
			return closeErr
		}
		if spec != nil {
			if written != spec.Bytes || hex.EncodeToString(digest.Sum(nil)) != spec.SHA256 {
				return errors.New("export source checksum changed")
			}
			read, e := os.Open(dest)
			if e != nil {
				return e
			}
			hash := sha256.New()
			_, e = io.Copy(hash, read)
			read.Close()
			if e != nil {
				return e
			}
			if hex.EncodeToString(hash.Sum(nil)) != spec.SHA256 {
				return errors.New("USB readback checksum differs")
			}
		}
		return nil
	}
	for i, spec := range manifest.Files {
		if e = copyFile(spec.Path, &spec); e != nil {
			return e
		}
		if progress != nil {
			progress(i+1, len(manifest.Files))
		}
	}
	if e = copyFile("export-manifest.json", nil); e != nil {
		return e
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	if verifyMount != nil {
		if e = verifyMount(); e != nil {
			return e
		}
	}
	// Reserve each export root without replacing anything. Rollback only roots created here.
	for _, name := range []string{"Contents", "PIONEER", "export-manifest.json"} {
		dest := filepath.Join(target, name)
		entries, e := os.ReadDir(target)
		if e != nil {
			return e
		}
		for _, entry := range entries {
			if strings.EqualFold(entry.Name(), name) {
				return errors.New("destination changed during transfer")
			}
		}
		source := filepath.Join(stage, name)
		info, e := os.Stat(source)
		if e != nil {
			return e
		}
		if info.IsDir() {
			if e = os.Mkdir(dest, 0700); e != nil {
				return e
			}
			published = append(published, dest)
			children, e := os.ReadDir(source)
			if e != nil {
				return e
			}
			for _, child := range children {
				if e = os.Rename(filepath.Join(source, child.Name()), filepath.Join(dest, child.Name())); e != nil {
					return e
				}
			}
		} else {
			input, e := os.Open(source)
			if e != nil {
				return e
			}
			output, e := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if e != nil {
				input.Close()
				return e
			}
			published = append(published, dest)
			_, e = io.Copy(output, input)
			input.Close()
			output.Sync()
			output.Close()
			if e != nil {
				return e
			}
		}
	}
	return nil
}
func (h *helper) usbRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /usb", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(usbDashboard)
	})
	mux.HandleFunc("GET /api/usb/status", func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		defer h.mu.Unlock()
		jsonReply(w, 200, map[string]any{"transfer": h.USB})
	})
	mux.HandleFunc("GET /api/usb/drives", func(w http.ResponseWriter, r *http.Request) {
		v, e := usbVolumes()
		if e != nil {
			jsonReply(w, 503, map[string]string{"error": e.Error()})
			return
		}
		jsonReply(w, 200, v)
	})
	mux.HandleFunc("POST /api/usb/receive", func(w http.ResponseWriter, r *http.Request) {
		var c connection
		if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536)).Decode(&c); e != nil {
			jsonReply(w, 400, map[string]string{"error": "invalid export handoff file"})
			return
		}
		if e := h.receiveUSB(c); e != nil {
			jsonReply(w, 409, map[string]string{"error": e.Error()})
			return
		}
		jsonReply(w, 200, map[string]bool{"accepted": true})
	})
	mux.HandleFunc("POST /api/usb/write", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			ID      string `json:"id"`
			Confirm bool   `json:"confirm"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&v) != nil || !v.Confirm {
			jsonReply(w, 400, map[string]string{"error": "confirm the selected USB destination first"})
			return
		}
		vol, e := findUSBVolume(v.ID)
		if e != nil {
			jsonReply(w, 409, map[string]string{"error": e.Error()})
			return
		}
		if e = destinationReady(vol.Path); e != nil {
			jsonReply(w, 409, map[string]string{"error": e.Error()})
			return
		}
		h.mu.Lock()
		u := h.USB
		if u == nil || u.Bundle == nil || (u.Status != "ready" && u.Status != "completed" && u.Status != "failed") {
			h.mu.Unlock()
			jsonReply(w, 409, map[string]string{"error": "wait for the export download to complete"})
			return
		}
		ctx, cancel := context.WithCancel(context.Background())
		u.Cancel = cancel
		u.Done = make(chan struct{})
		u.Status = "writing"
		u.Error = ""
		u.Destination = vol.Path
		u.Prepared = 0
		h.mu.Unlock()
		go func() {
			defer close(u.Done)
			defer cancel()
			e := writeUSB(ctx, u.Bundle, vol.Path, func() error {
				current, e := findUSBVolume(v.ID)
				if e != nil {
					return e
				}
				if current.Path != vol.Path {
					return errors.New("USB drive changed")
				}
				return nil
			}, func(done, total int) { h.mu.Lock(); u.Prepared = done; u.Total = total; h.mu.Unlock() })
			if e != nil {
				h.usbError(u, e)
				return
			}
			h.mu.Lock()
			u.Status = "completed"
			h.mu.Unlock()
		}()
		jsonReply(w, 200, map[string]bool{"writing": true})
	})
	mux.HandleFunc("POST /api/usb/cancel", func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		if h.USB != nil && h.USB.Cancel != nil {
			h.USB.Cancel()
		}
		h.mu.Unlock()
		jsonReply(w, 200, map[string]bool{"cancelled": true})
	})
}
