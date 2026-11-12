// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/vynulldev/vynull/pdb"
)

type usbEditRequest struct {
	ID             string `json:"id"`
	Kind           string `json:"kind"`
	TargetID       uint32 `json:"targetId"`
	DatabaseSHA256 string `json:"databaseSha256"`
	Confirmation   string `json:"confirmation"`
}

type usbEditPlan struct {
	Kind               string   `json:"kind"`
	TargetID           uint32   `json:"targetId"`
	DeletedTrackIDs    []uint32 `json:"deletedTrackIds"`
	DeletedPlaylistIDs []uint32 `json:"deletedPlaylistIds"`
	RemovedFiles       []string `json:"removedFiles"`
}

type usbEditRecovery struct {
	ID           string   `json:"id"`
	RemovedFiles []string `json:"removedFiles"`
}

const maxUSBEditPlanBytes = 16 << 20

func (h *helper) editUSB(request usbEditRequest) (*usbEditPlan, string, error) {
	if runtime.GOOS != "darwin" {
		return nil, "", errors.New("USB library editing is currently available on Mac")
	}
	if len(request.ID) != 64 || request.TargetID == 0 || (request.Kind != "track" && request.Kind != "playlist") || len(request.DatabaseSHA256) != 64 {
		return nil, "", errors.New("select a current track or playlist in the USB Library Manager")
	}
	if _, err := hex.DecodeString(request.ID); err != nil {
		return nil, "", errors.New("invalid USB drive selection")
	}
	if _, err := hex.DecodeString(request.DatabaseSHA256); err != nil {
		return nil, "", errors.New("read the USB library again before editing")
	}
	h.mu.Lock()
	busy := h.Updating || h.Sync == nil || !h.pairedLocked() || (h.USB != nil && (h.USB.Status == "writing" || h.USB.Status == "downloading"))
	var connection connection
	if h.Sync != nil {
		connection = h.Sync.Connection
	}
	h.mu.Unlock()
	if busy {
		return nil, "", errors.New("finish the current USB operation and check the Bridge connection before editing")
	}
	volume, err := h.findUSBVolume(request.ID)
	if err != nil {
		return nil, "", err
	}
	if volume.Contents != "dual-library" || h.bridgeUsingUSBVolume(volume) {
		return nil, "", errors.New("editing requires a dual-library USB that Bridge is not using for Network Link")
	}
	if request.Confirmation != "DELETE "+volume.Label {
		return nil, "", errors.New("type the requested drive confirmation before deleting")
	}
	if err = existingLibraryReady(volume.Path); err != nil {
		return nil, "", err
	}
	classic := filepath.Join(volume.Path, "PIONEER", "rekordbox", "export.pdb")
	if digest, digestErr := fileDigest(classic); digestErr != nil || digest != request.DatabaseSHA256 {
		return nil, "", errors.New("USB library changed since the report was read; read the drive again")
	}
	idBytes := make([]byte, 16)
	if _, err = rand.Read(idBytes); err != nil {
		return nil, "", err
	}
	id := hex.EncodeToString(idBytes)
	checkMount := func() error {
		current, findErr := h.findUSBVolume(request.ID)
		if findErr != nil || current.Path != volume.Path {
			return errors.New("USB drive changed during library edit")
		}
		return nil
	}
	backup, err := backupPlayerDatabases(volume.Path, h.Cache, id, checkMount)
	if err != nil {
		return nil, "", err
	}
	if backup.Digests["export.pdb"] != request.DatabaseSHA256 {
		return nil, "", errors.New("USB database changed during backup; read the drive again")
	}
	stage, err := os.MkdirTemp(h.Cache, "usb-edit-")
	if err != nil {
		return nil, "", err
	}
	defer os.RemoveAll(stage)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	client := &http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("USB edit redirects are not allowed")
	}}
	archive, err := requestEditedDatabases(ctx, client, connection, volume.Path, stage, request)
	if err != nil {
		return nil, "", err
	}
	if err = unchangedPlayerDatabases(volume.Path, backup.Digests); err != nil {
		return nil, "", err
	}
	plan, err := extractEditedDatabases(archive, stage)
	if err != nil {
		return nil, "", err
	}
	if err = validateUSBEditPlan(volume.Path, request, plan, stage); err != nil {
		return nil, "", err
	}
	if err = commitUSBEdit(ctx, volume.Path, stage, id, backup.Digests, plan, checkMount); err != nil {
		return nil, "", err
	}
	if h.Diagnostics != nil {
		h.Diagnostics.event("info", "usb.library-edited", map[string]any{"kind": plan.Kind, "tracks": len(plan.DeletedTrackIDs), "files": len(plan.RemovedFiles)})
	}
	return plan, backup.Path, nil
}

func requestEditedDatabases(ctx context.Context, client *http.Client, connection connection, root, stage string, edit usbEditRequest) (string, error) {
	reader, writer := io.Pipe()
	defer reader.Close()
	form := multipart.NewWriter(writer)
	go func() {
		var err error
		defer func() { _ = writer.CloseWithError(err) }()
		for _, name := range []string{"export.pdb", "exportLibrary.db"} {
			var part io.Writer
			part, err = form.CreateFormFile(map[string]string{"export.pdb": "classic", "exportLibrary.db": "oneLibrary"}[name], name)
			if err != nil {
				return
			}
			err = relayUSBDatabase(part, filepath.Join(root, "PIONEER", "rekordbox", name))
			if err != nil {
				return
			}
		}
		for key, value := range map[string]string{"kind": edit.Kind, "targetId": fmt.Sprint(edit.TargetID)} {
			if err = form.WriteField(key, value); err != nil {
				return
			}
		}
		err = form.Close()
	}()
	request, err := http.NewRequestWithContext(ctx, "POST", connection.ServerURL+"/edit-usb", reader)
	if err != nil {
		return "", err
	}
	request.Header.Set("X-Resonance-Link-Token", connection.Token)
	request.Header.Set("Content-Type", form.FormDataContentType())
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return "", fmt.Errorf("Resonance could not edit this USB library (HTTP %d): %s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	archive := filepath.Join(stage, "edited-databases.zip")
	output, err := os.OpenFile(archive, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	limit := 2*maxPlayerDatabaseBytes + maxUSBEditPlanBytes
	n, copyErr := io.Copy(output, io.LimitReader(response.Body, limit+1))
	if copyErr == nil {
		copyErr = output.Sync()
	}
	closeErr := output.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	if n > limit {
		return "", errors.New("edited databases are too large")
	}
	return archive, nil
}

func extractEditedDatabases(archive, stage string) (*usbEditPlan, error) {
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	if len(reader.File) != 3 {
		return nil, errors.New("USB edit response has unexpected files")
	}
	seen := map[string]bool{}
	for _, file := range reader.File {
		limit := maxPlayerDatabaseBytes
		if file.Name == "plan.json" {
			limit = maxUSBEditPlanBytes
		} else if file.Name != "export.pdb" && file.Name != "exportLibrary.db" {
			return nil, errors.New("USB edit response has an unexpected path")
		}
		if seen[file.Name] || !file.Mode().IsRegular() || file.UncompressedSize64 == 0 || file.UncompressedSize64 > uint64(limit) {
			return nil, errors.New("USB edit response is invalid")
		}
		seen[file.Name] = true
		input, openErr := file.Open()
		if openErr != nil {
			return nil, openErr
		}
		name := "edited-" + file.Name
		output, createErr := os.OpenFile(filepath.Join(stage, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if createErr != nil {
			input.Close()
			return nil, createErr
		}
		n, copyErr := io.Copy(output, io.LimitReader(input, limit+1))
		input.Close()
		if copyErr == nil {
			copyErr = output.Sync()
		}
		closeErr := output.Close()
		if copyErr != nil || closeErr != nil || n != int64(file.UncompressedSize64) {
			return nil, errors.New("USB edit response could not be verified")
		}
	}
	var plan usbEditPlan
	data, err := os.ReadFile(filepath.Join(stage, "edited-plan.json"))
	if err != nil || json.Unmarshal(data, &plan) != nil {
		return nil, errors.New("USB edit plan is invalid")
	}
	return &plan, nil
}

func validateUSBEditPlan(root string, request usbEditRequest, plan *usbEditPlan, stage string) error {
	if plan.Kind != request.Kind || plan.TargetID != request.TargetID {
		return errors.New("USB edit response selected a different item")
	}
	db, err := pdb.Open(filepath.Join(root, "PIONEER", "rekordbox", "export.pdb"))
	if err != nil {
		return err
	}
	tracks := make(map[uint32]*pdb.Track, len(db.Tracks))
	for _, track := range db.Tracks {
		tracks[track.ID] = track
	}
	deleting := map[uint32]bool{}
	playlists := []uint32{}
	switch request.Kind {
	case "track":
		if tracks[request.TargetID] == nil {
			return errors.New("track changed since the report was read")
		}
		deleting[request.TargetID] = true
	case "playlist":
		var selected *pdb.FolderNode
		other := map[uint32]bool{}
		for _, item := range db.PlaylistTree {
			if item.ID == request.TargetID {
				selected = item
			} else {
				for _, id := range item.TrackIDs {
					other[id] = true
				}
			}
		}
		if selected == nil || selected.IsFolder {
			return errors.New("playlist changed since the report was read")
		}
		for _, id := range selected.TrackIDs {
			if tracks[id] == nil {
				return errors.New("playlist references a missing track")
			}
			if !other[id] {
				deleting[id] = true
			}
		}
		playlists = append(playlists, request.TargetID)
	}
	ids := make([]uint32, 0, len(deleting))
	for id := range deleting {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	if !slices.Equal(ids, plan.DeletedTrackIDs) || !slices.Equal(playlists, plan.DeletedPlaylistIDs) {
		return errors.New("USB edit response disagrees with the current playlist")
	}
	remainingAudio := map[string]bool{}
	remainingAnalysis := map[string]bool{}
	for _, track := range db.Tracks {
		if !deleting[track.ID] {
			remainingAudio[track.FilePath] = true
			remainingAnalysis[track.AnalyzePath] = true
		}
	}
	files := map[string]bool{}
	for _, id := range ids {
		track := tracks[id]
		if !remainingAudio[track.FilePath] {
			files[track.FilePath] = true
		}
		if !remainingAnalysis[track.AnalyzePath] {
			files[track.AnalyzePath] = true
		}
	}
	expectedFiles := make([]string, 0, len(files))
	for path := range files {
		expectedFiles = append(expectedFiles, path)
	}
	sort.Strings(expectedFiles)
	if !slices.Equal(expectedFiles, plan.RemovedFiles) {
		return errors.New("USB edit response named unexpected files")
	}
	for _, path := range plan.RemovedFiles {
		if _, err := usbEditRelative(path); err != nil {
			return err
		}
	}
	updated, err := pdb.Open(filepath.Join(stage, "edited-export.pdb"))
	if err != nil {
		return fmt.Errorf("edited classic database cannot be read: %w", err)
	}
	if len(updated.Tracks) != len(db.Tracks)-len(ids) {
		return errors.New("edited classic track count is wrong")
	}
	for _, track := range updated.Tracks {
		if deleting[track.ID] {
			return errors.New("edited classic database retained a deleted track")
		}
	}
	for _, item := range updated.PlaylistTree {
		if slices.Contains(playlists, item.ID) {
			return errors.New("edited classic database retained a deleted playlist")
		}
	}
	return nil
}

func usbEditRelative(path string) (string, error) {
	if !strings.HasPrefix(path, "/Contents/") && !strings.HasPrefix(path, "/PIONEER/USBANLZ/") {
		return "", errors.New("USB edit contains a file outside audio or analysis folders")
	}
	if strings.ContainsAny(path, "\\\x00") || filepath.Clean(path) != path {
		return "", errors.New("USB edit contains an unsafe file path")
	}
	for _, part := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("USB edit contains an unsafe file path")
		}
	}
	return filepath.FromSlash(strings.TrimPrefix(path, "/")), nil
}

// Check every existing path component without following a symlink. Missing files
// are harmless: a database reference may already point to absent audio.
func safeUSBEditFile(root, relative string) (bool, error) {
	parts := strings.Split(filepath.ToSlash(relative), "/")
	path := root
	for index, part := range parts {
		path = filepath.Join(path, part)
		info, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return false, errors.New("USB edit file path is unreadable or linked")
		}
		if index < len(parts)-1 && !info.IsDir() {
			return false, errors.New("USB edit file parent is not a directory")
		}
		if index == len(parts)-1 && !info.Mode().IsRegular() {
			return false, errors.New("USB edit target is not a regular file")
		}
	}
	return true, nil
}

func syncUSBEditFile(path string, data []byte) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func commitUSBEdit(ctx context.Context, root, stage, id string, oldDigests map[string]string, plan *usbEditPlan, verifyMount func() error) (err error) {
	if err = unchangedPlayerDatabases(root, oldDigests); err != nil {
		return err
	}
	working := filepath.Join(root, ".resonance-edit-"+id)
	finished := filepath.Join(root, ".resonance-edit-done-"+id)
	if err = absent(working); err != nil {
		return err
	}
	if err = absent(finished); err != nil {
		return err
	}
	if err = os.Mkdir(working, 0700); err != nil {
		return err
	}
	ready := false
	committed := false
	defer func() {
		if err == nil || committed {
			return
		}
		if !ready {
			_ = os.RemoveAll(working)
			return
		}
		if recovery := rollbackUSBEdit(root, working, id); recovery != nil {
			err = fmt.Errorf("%w; USB recovery is required: %v", err, recovery)
		}
	}()
	dbRoot := filepath.Join(root, "PIONEER", "rekordbox")
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		if err = copyExclusive(filepath.Join(dbRoot, name), filepath.Join(working, name)); err != nil {
			return err
		}
		var digest string
		if digest, err = fileDigest(filepath.Join(working, name)); err != nil || digest != oldDigests[name] {
			return errors.New("USB edit backup failed readback verification")
		}
	}
	manifest, err := json.Marshal(usbEditRecovery{ID: id, RemovedFiles: plan.RemovedFiles})
	if err != nil {
		return err
	}
	if err = syncUSBEditFile(filepath.Join(working, "manifest.json"), manifest); err != nil {
		return err
	}
	if err = syncUSBEditFile(filepath.Join(working, "ready"), []byte(id)); err != nil {
		return err
	}
	ready = true
	for _, path := range plan.RemovedFiles {
		if err = ctx.Err(); err != nil {
			return err
		}
		if verifyMount != nil {
			if err = verifyMount(); err != nil {
				return err
			}
		}
		relative, pathErr := usbEditRelative(path)
		if pathErr != nil {
			return pathErr
		}
		exists, pathErr := safeUSBEditFile(root, relative)
		if pathErr != nil {
			return pathErr
		}
		if !exists {
			continue
		}
		quarantined := filepath.Join(working, "files", relative)
		if err = os.MkdirAll(filepath.Dir(quarantined), 0700); err != nil {
			return err
		}
		if err = os.Rename(filepath.Join(root, relative), quarantined); err != nil {
			return err
		}
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		temporary := filepath.Join(dbRoot, ".resonance-new-"+id+"-"+name)
		if err = copyExclusive(filepath.Join(stage, "edited-"+name), temporary); err != nil {
			return err
		}
		var want, got string
		if want, err = fileDigest(filepath.Join(stage, "edited-"+name)); err != nil {
			return err
		}
		if got, err = fileDigest(temporary); err != nil || got != want {
			return errors.New("edited database failed USB readback verification")
		}
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if verifyMount != nil {
		if err = verifyMount(); err != nil {
			return err
		}
	}
	if err = unchangedPlayerDatabases(root, oldDigests); err != nil {
		return err
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		temporary := filepath.Join(dbRoot, ".resonance-new-"+id+"-"+name)
		if err = os.Rename(temporary, filepath.Join(dbRoot, name)); err != nil {
			return err
		}
		var want, got string
		if want, err = fileDigest(filepath.Join(stage, "edited-"+name)); err != nil {
			return err
		}
		if got, err = fileDigest(filepath.Join(dbRoot, name)); err != nil || got != want {
			return errors.New("edited database failed final readback verification")
		}
	}
	if err = os.Rename(working, finished); err != nil {
		return err
	}
	committed = true
	if err = os.RemoveAll(finished); err != nil {
		return fmt.Errorf("USB library was edited, but cleanup needs recovery: %w", err)
	}
	return nil
}

func rollbackUSBEdit(root, working, id string) error {
	if err := safeDirectory(working); err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(working, "manifest.json"))
	if err != nil || len(data) > maxUSBEditPlanBytes {
		return errors.New("USB edit recovery manifest is unavailable")
	}
	var manifest usbEditRecovery
	if json.Unmarshal(data, &manifest) != nil || manifest.ID != id {
		return errors.New("USB edit recovery manifest is invalid")
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		backup := filepath.Join(working, name)
		info, statErr := os.Lstat(backup)
		if statErr != nil || !info.Mode().IsRegular() || info.Size() < 1024 || info.Size() > maxPlayerDatabaseBytes {
			return errors.New("USB edit database backup is incomplete")
		}
		if err = replaceFromBackup(backup, filepath.Join(root, "PIONEER", "rekordbox", name), id); err != nil {
			return err
		}
	}
	for _, path := range manifest.RemovedFiles {
		relative, pathErr := usbEditRelative(path)
		if pathErr != nil {
			return pathErr
		}
		quarantined := filepath.Join(working, "files", relative)
		exists, pathErr := safeUSBEditFile(filepath.Join(working, "files"), relative)
		if pathErr != nil {
			return pathErr
		}
		if !exists {
			continue
		}
		if current, checkErr := safeUSBEditFile(root, relative); checkErr != nil || current {
			return errors.New("USB edit recovery would replace an existing file")
		}
		if err = os.Rename(quarantined, filepath.Join(root, relative)); err != nil {
			return err
		}
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		_ = os.Remove(filepath.Join(root, "PIONEER", "rekordbox", ".resonance-new-"+id+"-"+name))
	}
	return os.RemoveAll(working)
}

func (h *helper) recoverInterruptedUSBEdit(volume usbVolume) (bool, error) {
	working, err := filepath.Glob(filepath.Join(volume.Path, ".resonance-edit-*"))
	if err != nil || len(working) == 0 {
		return false, err
	}
	if len(working) != 1 {
		return true, errors.New("multiple interrupted USB edits need manual review")
	}
	folder := working[0]
	if err = safeDirectory(folder); err != nil {
		return true, err
	}
	name := filepath.Base(folder)
	if strings.HasPrefix(name, ".resonance-edit-done-") {
		return true, os.RemoveAll(folder)
	}
	id := strings.TrimPrefix(name, ".resonance-edit-")
	if len(id) != 32 {
		return true, errors.New("invalid USB edit recovery folder")
	}
	if _, err = hex.DecodeString(id); err != nil {
		return true, errors.New("invalid USB edit recovery folder")
	}
	marker, err := os.ReadFile(filepath.Join(folder, "ready"))
	if errors.Is(err, os.ErrNotExist) {
		return true, os.RemoveAll(folder)
	}
	if err != nil || string(marker) != id {
		return true, errors.New("USB edit recovery marker is invalid")
	}
	if err = rollbackUSBEdit(volume.Path, folder, id); err != nil {
		return true, err
	}
	if h.Diagnostics != nil {
		h.Diagnostics.event("warning", "usb.edit-recovered", map[string]any{"label": volume.Label})
	}
	return true, nil
}
