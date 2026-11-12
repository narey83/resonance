// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type usbTransfer struct {
	Done           chan struct{}      `json:"-"`
	Status         string             `json:"status"`
	Error          string             `json:"error"`
	Name           string             `json:"name"`
	Tracks         int                `json:"tracks"`
	Profile        string             `json:"profile,omitempty"`
	Phase          string             `json:"phase,omitempty"`
	DatabaseBackup string             `json:"databaseBackup,omitempty"`
	Destination    string             `json:"destination,omitempty"`
	DestinationID  string             `json:"destinationId,omitempty"`
	Prepared       int                `json:"prepared"`
	Total          int                `json:"total"`
	Downloaded     int64              `json:"downloadedBytes"`
	TotalBytes     int64              `json:"totalBytes"`
	Export         *usbPrepared       `json:"-"`
	Cancel         context.CancelFunc `json:"-"`
	Connection     connection         `json:"-"`
}

type usbPrepared struct {
	Manifest exportManifest
	Data     []byte
	Bytes    int64
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
	h.operation.Lock()
	defer h.operation.Unlock()
	if e := validateConnection(c); e != nil {
		return e
	}
	if !isUSB(c) {
		return errors.New("select a USB export handoff file")
	}
	h.mu.Lock()
	if !h.pairedLocked() {
		h.mu.Unlock()
		return errors.New("Pair Bridge in Settings before receiving a USB export")
	}
	if !sameInstance(h.Sync.Connection, c) {
		h.mu.Unlock()
		return errors.New("This USB export belongs to a different Resonance instance. Pair that instance in Bridge Settings first")
	}
	if h.Updating {
		h.mu.Unlock()
		return errors.New("helper update is restarting")
	}
	if h.USB != nil && (h.USB.Status == "downloading" || h.USB.Status == "writing") {
		h.mu.Unlock()
		return errors.New("finish or cancel the current USB transfer first")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	u := &usbTransfer{Status: "downloading", Cancel: cancel, Done: make(chan struct{}), Connection: c}
	h.USB = u
	h.mu.Unlock()
	go h.watchUSB(u)
	go func() {
		defer close(u.Done)
		defer cancel()
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("export download redirects are not allowed")
		}}
		prepared, e := downloadUSBManifest(ctx, client, c)
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
			return
		}
		u.Export = prepared
		u.Status = "ready"
		h.Diagnostics.event("info", "usb.ready", map[string]any{"tracks": prepared.Manifest.TrackCount, "bytes": prepared.Bytes})
		u.Name = prepared.Manifest.PlaylistName
		u.Tracks = prepared.Manifest.TrackCount
		u.Profile = prepared.Manifest.Profile
		u.Total = len(prepared.Manifest.Files)
		u.TotalBytes = prepared.Bytes
		h.mu.Unlock()
	}()
	return nil
}

// The saved server job is authoritative. A browser can defer or cancel it while
// Bridge is open; release the prepared manifest once the server reports that change.
func (h *helper) watchUSB(u *usbTransfer) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		h.mu.Lock()
		current := h.USB == u
		writing := u.Status == "writing"
		h.mu.Unlock()
		if !current {
			return
		}
		if writing {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("export state redirects are not allowed")
		}}
		request, err := http.NewRequestWithContext(ctx, "GET", u.Connection.ServerURL+"/state", nil)
		if err == nil {
			request.Header.Set("X-Resonance-Link-Token", u.Connection.Token)
			var response *http.Response
			response, err = client.Do(request)
			if err == nil {
				var state struct {
					Deferred bool `json:"deferred"`
				}
				if response.StatusCode == http.StatusOK {
					err = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&state)
				}
				response.Body.Close()
				if response.StatusCode == http.StatusNotFound {
					// An older Resonance instance has no state route. Check its
					// manifest once before treating 404 as a cancelled job.
					manifest, manifestErr := fetchSync(ctx, client, u.Connection, "/manifest")
					if manifestErr == nil {
						manifest.Body.Close()
						cancel()
						return
					}
					if !strings.Contains(manifestErr.Error(), "HTTP 404") {
						cancel()
						continue
					}
				}
				if response.StatusCode == http.StatusNotFound || (err == nil && response.StatusCode == http.StatusOK && state.Deferred) {
					h.mu.Lock()
					var done chan struct{}
					if h.USB == u && u.Status == "downloading" {
						u.Cancel()
						done = u.Done
					}
					h.mu.Unlock()
					if done != nil {
						<-done
					}
					h.releaseUSB(u, "usb.remote_release")
					cancel()
					return
				}
			}
		}
		cancel()
	}
}

func (h *helper) releaseUSB(u *usbTransfer, event string) bool {
	h.mu.Lock()
	if h.USB != u || u == nil || u.Status == "downloading" || u.Status == "writing" {
		h.mu.Unlock()
		return false
	}
	h.USB = nil
	h.mu.Unlock()
	if h.Diagnostics != nil {
		h.Diagnostics.event("info", event, nil)
	}
	return true
}

func (h *helper) changeUSBJob(u *usbTransfer, action string) error {
	if action != "defer" && action != "cancel" {
		return errors.New("unknown export action")
	}
	h.mu.Lock()
	ready := h.USB == u && u != nil && u.Status != "downloading" && u.Status != "writing"
	h.mu.Unlock()
	if !ready {
		return errors.New("wait for the current USB operation to finish")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "POST", u.Connection.ServerURL+"/"+action, nil)
	if err != nil {
		return err
	}
	request.Header.Set("X-Resonance-Link-Token", u.Connection.Token)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("export action redirects are not allowed")
	}}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errors.New("Resonance could not " + action + " this export")
	}
	h.releaseUSB(u, "usb."+action)
	return nil
}

// Fetch only the inventory. Track bytes stay on Resonance until a USB drive is
// selected, then pass through Bridge directly into a staging folder on that drive.
func downloadUSBManifest(ctx context.Context, client *http.Client, c connection) (*usbPrepared, error) {
	response, err := fetchSync(ctx, client, c, "/manifest")
	if err != nil {
		return nil, err
	}
	manifestBytes, err := io.ReadAll(io.LimitReader(response.Body, 16<<20+1))
	response.Body.Close()
	if err != nil || len(manifestBytes) > 16<<20 {
		return nil, errors.New("USB export manifest is unreadable or too large")
	}
	var manifest exportManifest
	if err = json.Unmarshal(manifestBytes, &manifest); err != nil {
		return nil, err
	}
	if manifest.SchemaVersion != 1 || (manifest.Profile != "dual" && manifest.Profile != "legacy") || manifest.TrackCount < 1 || manifest.TrackCount > 65535 || manifest.PlaylistName == "" || len(manifest.Files) == 0 || len(manifest.Files) > 100000 || len(manifest.Streams) != 0 {
		return nil, errors.New("unsupported USB export manifest")
	}
	var total int64
	seen := map[string]bool{}
	for _, spec := range manifest.Files {
		name, nameErr := safeName(spec.Path)
		if nameErr != nil || name == "export-manifest.json" || seen[strings.ToLower(name)] || spec.Bytes < 0 || spec.Bytes > maxBundleBytes-total || !validDigest(spec.SHA256) {
			return nil, errors.New("invalid USB export file inventory")
		}
		seen[strings.ToLower(name)] = true
		total += spec.Bytes
	}
	if !seen["pioneer/rekordbox/export.pdb"] {
		return nil, errors.New("USB export has no player database")
	}
	return &usbPrepared{Manifest: manifest, Data: manifestBytes, Bytes: total}, nil
}
func (h *helper) usbError(u *usbTransfer, e error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.USB == u {
		u.Status = "failed"
		u.Error = e.Error()
		h.Diagnostics.event("warning", "usb.failed", map[string]any{"error": e.Error()})
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
func writeUSB(ctx context.Context, b *bundle, target string, verifyMount func() error, progress func(int, int)) error {
	data, err := os.ReadFile(filepath.Join(b.Root, "export-manifest.json"))
	if err != nil {
		return err
	}
	var manifest exportManifest
	if err = json.Unmarshal(data, &manifest); err != nil {
		return err
	}
	return writeUSBFiles(ctx, &usbPrepared{Manifest: manifest, Data: data}, target, verifyMount,
		func(_ int64, done, total int) {
			if progress != nil && done > 0 {
				progress(done, total)
			}
		}, func(relative string) (io.ReadCloser, error) {
			source := filepath.Join(b.Root, filepath.FromSlash(relative))
			if e := requireUnder(b.Root, source); e != nil {
				return nil, e
			}
			return os.Open(source)
		})
}

func writeUSBStream(ctx context.Context, prepared *usbPrepared, c connection, target string, verifyMount func() error, progress func(int64, int, int)) error {
	return writeUSBStreamMode(ctx, prepared, c, target, verifyMount, progress, false, "", nil)
}

func writeUSBStreamMode(ctx context.Context, prepared *usbPrepared, c connection, target string, verifyMount func() error, progress func(int64, int, int), mergeExisting bool, backupRoot string, onBackup func(string)) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("export stream redirects are not allowed")
	}}
	var backup *playerDatabaseBackup
	if mergeExisting {
		var err error
		backup, err = backupPlayerDatabases(target, backupRoot, prepared.Manifest.JobID, verifyMount)
		if err != nil {
			return err
		}
		if onBackup != nil {
			onBackup(backup.Path)
		}
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	return writeUSBFilesMode(ctx, prepared, target, verifyMount, progress, func(relative string) (io.ReadCloser, error) {
		response, err := fetchSync(ctx, client, c, "/file?path="+url.QueryEscape(relative))
		if err != nil {
			return nil, err
		}
		return response.Body, nil
	}, func(stage string) error {
		if !mergeExisting {
			return nil
		}
		return publishMergedUSB(ctx, client, c, prepared, stage, target, verifyMount, backup)
	}, mergeExisting)
}

func writeUSBFiles(ctx context.Context, prepared *usbPrepared, target string, verifyMount func() error, progress func(int64, int, int), openFile func(string) (io.ReadCloser, error)) (err error) {
	return writeUSBFilesMode(ctx, prepared, target, verifyMount, progress, openFile, nil, false)
}

func writeUSBFilesMode(ctx context.Context, prepared *usbPrepared, target string, verifyMount func() error, progress func(int64, int, int), openFile func(string) (io.ReadCloser, error), merge func(string) error, existing bool) (err error) {
	check := destinationReady
	if existing {
		check = existingLibraryReady
	}
	if e := check(target); e != nil {
		return e
	}
	if verifyMount != nil {
		if e := verifyMount(); e != nil {
			return e
		}
	}
	manifest := prepared.Manifest
	var e error
	var requiredBytes uint64
	for _, spec := range manifest.Files {
		if spec.Bytes < 0 {
			return errors.New("invalid export size")
		}
		requiredBytes += uint64(spec.Bytes)
	}
	free, e := freeBytes(target)
	if e != nil {
		return e
	}
	if free < requiredBytes+16*1024*1024 {
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
		dest := filepath.Join(stage, filepath.FromSlash(relative))
		if e := os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
			return e
		}
		var in io.ReadCloser
		if spec == nil {
			in = io.NopCloser(bytes.NewReader(prepared.Data))
		} else {
			in, e = openFile(relative)
			if e != nil {
				return e
			}
		}
		defer in.Close()
		out, e := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return e
		}
		digest := sha256.New()
		var written int64
		buf := make([]byte, 1<<20)
		var source io.Reader = in
		if spec != nil {
			source = io.LimitReader(in, spec.Bytes+1)
		}
		for {
			if e = ctx.Err(); e != nil {
				break
			}
			n, readErr := source.Read(buf)
			if n > 0 {
				count, writeErr := out.Write(buf[:n])
				digest.Write(buf[:count])
				written += int64(count)
				if spec != nil && progress != nil && count > 0 {
					progress(int64(count), 0, len(manifest.Files))
				}
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
			progress(0, i+1, len(manifest.Files))
		}
	}
	if e = copyFile("export-manifest.json", nil); e != nil {
		return e
	}
	if _, e = loadBundle(stage, manifest); e != nil {
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
	if existing {
		return merge(stage)
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
	mux.HandleFunc("GET /api/usb/status", func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		defer h.mu.Unlock()
		jsonReply(w, 200, map[string]any{"transfer": h.USB})
	})
	mux.HandleFunc("GET /api/usb/drives", func(w http.ResponseWriter, r *http.Request) {
		v, e := h.usbDeviceManager().List()
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
	mux.HandleFunc("POST /api/usb/eject", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			ID string `json:"id"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&request) != nil || len(request.ID) != 64 {
			jsonReply(w, 400, map[string]string{"error": "select a mounted USB drive to safely eject"})
			return
		}
		if _, err := hex.DecodeString(request.ID); err != nil {
			jsonReply(w, 400, map[string]string{"error": "invalid USB drive selection"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		volume, err := h.ejectUSB(ctx, request.ID)
		if err != nil {
			jsonReply(w, 409, map[string]string{"error": err.Error()})
			return
		}
		jsonReply(w, 200, map[string]any{"ejected": true, "label": volume.Label})
	})
	mux.HandleFunc("POST /api/usb/format", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			ID           string `json:"id"`
			Confirmation string `json:"confirmation"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&request) != nil || len(request.ID) != 64 {
			jsonReply(w, 400, map[string]string{"error": "select a mounted USB drive to format"})
			return
		}
		if _, err := hex.DecodeString(request.ID); err != nil {
			jsonReply(w, 400, map[string]string{"error": "invalid USB drive selection"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()
		backupPath, err := h.formatUSB(ctx, request.ID, request.Confirmation)
		if err != nil {
			jsonReply(w, 409, map[string]string{"error": err.Error()})
			return
		}
		jsonReply(w, 200, map[string]any{"formatted": true, "label": formattedUSBLabel, "databaseBackup": backupPath})
	})
	mux.HandleFunc("POST /api/usb/recover", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			ID string `json:"id"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&request) != nil || len(request.ID) != 64 {
			jsonReply(w, 400, map[string]string{"error": "select an interrupted USB export to recover"})
			return
		}
		if _, err := hex.DecodeString(request.ID); err != nil {
			jsonReply(w, 400, map[string]string{"error": "invalid USB drive selection"})
			return
		}
		if err := h.recoverInterruptedUSB(request.ID); err != nil {
			jsonReply(w, 409, map[string]string{"error": err.Error()})
			return
		}
		jsonReply(w, 200, map[string]bool{"recovered": true})
	})
	mux.HandleFunc("POST /api/usb/write", func(w http.ResponseWriter, r *http.Request) {
		if !h.operation.TryLock() {
			jsonReply(w, 409, map[string]string{"error": "another Bridge operation is in progress"})
			return
		}
		defer h.operation.Unlock()
		var v struct {
			ID      string `json:"id"`
			Confirm bool   `json:"confirm"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&v) != nil || !v.Confirm {
			jsonReply(w, 400, map[string]string{"error": "confirm the selected USB destination first"})
			return
		}
		vol, e := h.findUSBVolume(v.ID)
		if e != nil {
			jsonReply(w, 409, map[string]string{"error": e.Error()})
			return
		}
		mergeExisting := vol.Contents == "dual-library" && runtime.GOOS == "darwin"
		check := destinationReady
		if mergeExisting {
			check = existingLibraryReady
		}
		if e = check(vol.Path); e != nil {
			jsonReply(w, 409, map[string]string{"error": e.Error()})
			return
		}
		h.mu.Lock()
		u := h.USB
		if h.Updating || u == nil || u.Export == nil || (u.Status != "ready" && u.Status != "completed" && u.Status != "failed" && u.Status != "ejected") {
			h.mu.Unlock()
			jsonReply(w, 409, map[string]string{"error": "wait for the export manifest to load"})
			return
		}
		if mergeExisting && u.Profile != "dual" {
			h.mu.Unlock()
			jsonReply(w, 409, map[string]string{"error": "prepare a dual-library export to add to this USB drive"})
			return
		}
		ctx, cancel := context.WithCancel(context.Background())
		u.Cancel = cancel
		u.Done = make(chan struct{})
		u.Status = "writing"
		u.Phase = "streaming"
		if mergeExisting {
			u.Phase = "backing-up"
		}
		u.DatabaseBackup = ""
		h.Diagnostics.event("info", "usb.writing", nil)
		u.Error = ""
		u.Destination = vol.Path
		u.DestinationID = vol.ID
		u.Prepared = 0
		u.Downloaded = 0
		u.Total = len(u.Export.Manifest.Files)
		u.TotalBytes = u.Export.Bytes
		h.mu.Unlock()
		go func() {
			defer close(u.Done)
			defer cancel()
			e := writeUSBStreamMode(ctx, u.Export, u.Connection, vol.Path, func() error {
				current, e := h.findUSBVolume(v.ID)
				if e != nil {
					return e
				}
				if current.Path != vol.Path {
					return errors.New("USB drive changed")
				}
				return nil
			}, func(downloaded int64, done, total int) {
				h.mu.Lock()
				u.Downloaded += downloaded
				if done > 0 {
					u.Prepared = done
				}
				u.Total = total
				h.mu.Unlock()
			}, mergeExisting, h.Cache, func(path string) {
				h.mu.Lock()
				u.DatabaseBackup = path
				u.Phase = "streaming"
				h.mu.Unlock()
			})
			if e != nil {
				h.usbError(u, e)
				return
			}
			h.mu.Lock()
			u.Status = "completed"
			h.Diagnostics.event("info", "usb.completed", nil)
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
	for _, action := range []string{"defer", "cancel-job"} {
		name := action
		mux.HandleFunc("POST /api/usb/"+name, func(w http.ResponseWriter, r *http.Request) {
			h.mu.Lock()
			u := h.USB
			h.mu.Unlock()
			remote := name
			if remote == "cancel-job" {
				remote = "cancel"
			}
			if err := h.changeUSBJob(u, remote); err != nil {
				jsonReply(w, 409, map[string]string{"error": err.Error()})
				return
			}
			jsonReply(w, 200, map[string]bool{"released": true})
		})
	}
}
