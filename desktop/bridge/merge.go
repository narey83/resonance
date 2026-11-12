// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

const maxPlayerDatabaseBytes int64 = 128 << 20
const maxUSBExportRecordsBytes int64 = 16 << 20

type playerDatabaseBackup struct {
	Path    string
	Digests map[string]string
}

// Copy and verify the player databases off the USB before creating any staging file
// on the destination. These are metadata only; audio never enters the Mac cache.
func backupPlayerDatabases(target, cache, jobID string, verifyMount func() error) (_ *playerDatabaseBackup, err error) {
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(jobID) {
		return nil, errors.New("prepare a new export before adding to an existing USB library")
	}
	if err = existingLibraryReady(target); err != nil {
		return nil, err
	}
	names := []string{"export.pdb", "exportLibrary.db"}
	if _, err := os.Lstat(filepath.Join(target, "PIONEER", "rekordbox", "exportExt.pdb")); err == nil {
		names = append(names, "exportExt.pdb")
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return backupNamedPlayerDatabases(target, cache, jobID, names, verifyMount)
}

func backupNamedPlayerDatabases(target, cache, jobID string, names []string, verifyMount func() error) (_ *playerDatabaseBackup, err error) {
	if len(names) == 0 || !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(jobID) {
		return nil, errors.New("no valid player databases selected for backup")
	}
	if verifyMount != nil {
		if err = verifyMount(); err != nil {
			return nil, err
		}
	}
	realCache, err := filepath.EvalSymlinks(cache)
	if err != nil || onUSBVolume(target, realCache) {
		return nil, errors.New("Bridge database backup must use local storage outside the USB drive")
	}
	base := filepath.Join(realCache, "usb-db-backups")
	if err = os.MkdirAll(base, 0700); err != nil {
		return nil, err
	}
	if err = safeDirectory(base); err != nil {
		return nil, errors.New("Bridge database backup directory is unsafe")
	}
	realBase, err := filepath.EvalSymlinks(base)
	if err != nil || !onUSBVolume(realCache, realBase) || onUSBVolume(target, realBase) {
		return nil, errors.New("Bridge database backup must stay in its private local cache")
	}
	backup, err := os.MkdirTemp(base, jobID+"-")
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(backup)
		}
	}()
	before := make(map[string]string, len(names))
	for _, name := range names {
		if filepath.Base(name) != name || !(strings.HasSuffix(name, ".pdb") || strings.HasSuffix(name, ".db")) {
			return nil, errors.New("invalid player database backup path")
		}
		path := filepath.Join(target, "PIONEER", "rekordbox", name)
		info, statErr := os.Lstat(path)
		if statErr != nil || !info.Mode().IsRegular() || info.Size() > maxPlayerDatabaseBytes {
			return nil, errors.New("player database is missing, linked or too large for backup")
		}
		if before[name], err = fileDigest(path); err != nil {
			return nil, err
		}
	}
	for _, name := range names {
		if err = copyExclusive(filepath.Join(target, "PIONEER", "rekordbox", name), filepath.Join(backup, name)); err != nil {
			return nil, err
		}
		var copied string
		if copied, err = fileDigest(filepath.Join(backup, name)); err != nil {
			return nil, err
		}
		if copied != before[name] {
			return nil, errors.New("player database backup checksum differs")
		}
	}
	for name, digest := range before {
		var current string
		if current, err = fileDigest(filepath.Join(target, "PIONEER", "rekordbox", name)); err != nil {
			return nil, err
		}
		if current != digest {
			return nil, errors.New("player database changed during backup; close rekordbox and retry")
		}
	}
	if verifyMount != nil {
		if err = verifyMount(); err != nil {
			return nil, err
		}
	}
	record, err := json.Marshal(struct {
		JobID   string            `json:"jobId"`
		Source  string            `json:"source"`
		Created time.Time         `json:"created"`
		SHA256  map[string]string `json:"sha256"`
	}{JobID: jobID, Source: target, Created: time.Now().UTC(), SHA256: before})
	if err != nil {
		return nil, err
	}
	metadata, err := os.OpenFile(filepath.Join(backup, "backup.json"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	_, err = metadata.Write(record)
	if err == nil {
		err = metadata.Sync()
	}
	closeMetadataErr := metadata.Close()
	if err != nil {
		return nil, err
	}
	if closeMetadataErr != nil {
		return nil, closeMetadataErr
	}
	directory, err := os.Open(backup)
	if err != nil {
		return nil, err
	}
	err = directory.Sync()
	closeErr := directory.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	parent, err := os.Open(base)
	if err != nil {
		return nil, err
	}
	err = parent.Sync()
	closeErr = parent.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	return &playerDatabaseBackup{Path: backup, Digests: before}, nil
}

func existingLibraryReady(root string) error {
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("destination must be a mounted USB directory")
	}
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	abs, err := filepath.Abs(root)
	if err != nil || real != abs || real == string(filepath.Separator) {
		return errors.New("USB destination path is unsafe")
	}
	if inspectUSBContents(root) == "recovery-needed" {
		return errors.New("an interrupted USB export needs recovery before another write")
	}
	if inspectUSBContents(root) != "dual-library" {
		return errors.New("this USB needs both classic and OneLibrary databases before Bridge can add a set")
	}
	for _, relative := range []string{"Contents", "PIONEER", "PIONEER/rekordbox"} {
		part, err := os.Lstat(filepath.Join(root, filepath.FromSlash(relative)))
		if err != nil || !part.IsDir() || part.Mode()&os.ModeSymlink != 0 {
			return errors.New("USB library has an unsafe directory")
		}
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		path := filepath.Join(root, "PIONEER", "rekordbox", name)
		part, err := os.Lstat(path)
		if err != nil || !part.Mode().IsRegular() || part.Size() < 1024 || part.Size() > maxPlayerDatabaseBytes {
			return errors.New("existing player database is missing, linked or too large")
		}
		for _, suffix := range []string{"-wal", "-shm", "-journal"} {
			if _, err := os.Lstat(path + suffix); err == nil {
				return errors.New("rekordbox has an open database journal on this USB; close rekordbox and eject it cleanly first")
			} else if !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	if extended, err := os.Lstat(filepath.Join(root, "PIONEER", "rekordbox", "exportExt.pdb")); err == nil {
		if !extended.Mode().IsRegular() || extended.Size() < 1024 || extended.Size() > maxPlayerDatabaseBytes {
			return errors.New("extended player database is linked or invalid")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// Relay only existing player metadata to Resonance. Audio is checked in place on
// the mounted USB and is never copied into Bridge storage or uploaded.
func preflightExistingUSB(ctx context.Context, client *http.Client, c connection, target string, verifyMount func() error) (map[string]string, error) {
	if err := existingLibraryReady(target); err != nil {
		return nil, err
	}
	if verifyMount != nil {
		if err := verifyMount(); err != nil {
			return nil, err
		}
	}
	records, err := usbExportRecords(target)
	if err != nil {
		return nil, err
	}
	digests := make(map[string]string, 2)
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		digests[name], err = fileDigest(filepath.Join(target, "PIONEER", "rekordbox", name))
		if err != nil {
			return nil, err
		}
	}
	reader, writer := io.Pipe()
	defer reader.Close()
	form := multipart.NewWriter(writer)
	go func() {
		var writeErr error
		defer func() { _ = writer.CloseWithError(writeErr) }()
		for _, name := range []string{"export.pdb", "exportLibrary.db"} {
			var part io.Writer
			part, writeErr = form.CreateFormFile(map[string]string{"export.pdb": "classic", "exportLibrary.db": "oneLibrary"}[name], name)
			if writeErr != nil {
				return
			}
			writeErr = relayUSBDatabase(part, filepath.Join(target, "PIONEER", "rekordbox", name))
			if writeErr != nil {
				return
			}
		}
		var part io.Writer
		part, writeErr = form.CreateFormFile("records", "records.json")
		if writeErr != nil {
			return
		}
		writeErr = json.NewEncoder(part).Encode(records)
		if writeErr == nil {
			writeErr = form.Close()
		}
	}()
	request, err := http.NewRequestWithContext(ctx, "POST", c.ServerURL+"/preflight", reader)
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-Resonance-Link-Token", c.Token)
	request.Header.Set("Content-Type", form.FormDataContentType())
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return nil, fmt.Errorf("Resonance rejected this USB export (HTTP %d): %s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	var result struct {
		AudioPaths []string `json:"audioPaths"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 32<<20)).Decode(&result); err != nil || len(result.AudioPaths) > 100000 {
		return nil, errors.New("Resonance returned an invalid USB library check")
	}
	if err := unchangedPlayerDatabases(target, digests); err != nil {
		return nil, err
	}
	missing := []string{}
	for _, usbPath := range result.AudioPaths {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !strings.HasPrefix(usbPath, "/Contents/") || len(usbPath) > 4096 {
			return nil, errors.New("existing player database references an unsafe audio path")
		}
		relative, err := safeName(strings.TrimPrefix(usbPath, "/"))
		if err != nil {
			return nil, errors.New("existing player database references an unsafe audio path")
		}
		path := filepath.Join(target, filepath.FromSlash(relative))
		info, statErr := os.Lstat(path)
		if errors.Is(statErr, os.ErrNotExist) || (statErr == nil && (!info.Mode().IsRegular() || info.Size() == 0)) {
			missing = append(missing, usbPath)
			continue
		}
		if statErr != nil {
			return nil, statErr
		}
		if err := requireUnder(target, path); err != nil {
			return nil, errors.New("existing player database references audio outside the USB drive")
		}
	}
	if len(missing) != 0 {
		return nil, fmt.Errorf("existing USB library references %d missing track(s), including %s; restore them before adding a set", len(missing), strings.Join(missing[:min(3, len(missing))], ", "))
	}
	if verifyMount != nil {
		if err := verifyMount(); err != nil {
			return nil, err
		}
	}
	return digests, nil
}

func usbExportRecords(target string) ([]json.RawMessage, error) {
	paths := []string{filepath.Join(target, "export-manifest.json")}
	directory := filepath.Join(target, "ResonanceExports")
	if info, err := os.Lstat(directory); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("USB export records directory is unsafe")
		}
		entries, err := os.ReadDir(directory)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
				paths = append(paths, filepath.Join(directory, entry.Name()))
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if len(paths) > 501 {
		return nil, errors.New("USB has too many Resonance export records to check safely")
	}
	records := []json.RawMessage{}
	var total int64
	for _, path := range paths {
		info, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) && path == paths[0] {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() || info.Size() > maxUSBExportRecordsBytes-total {
			return nil, errors.New("USB export record is linked or too large")
		}
		if err := requireUnder(target, path); err != nil {
			return nil, errors.New("USB export record is outside the selected drive")
		}
		input, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		opened, statErr := input.Stat()
		if statErr != nil || !os.SameFile(info, opened) {
			input.Close()
			return nil, errors.New("USB export record changed while it was being read")
		}
		data, err := io.ReadAll(io.LimitReader(input, maxUSBExportRecordsBytes-total+1))
		input.Close()
		if err != nil {
			return nil, err
		}
		if int64(len(data)) != info.Size() || !json.Valid(data) {
			return nil, errors.New("USB export record is invalid")
		}
		total += int64(len(data))
		records = append(records, json.RawMessage(data))
	}
	return records, nil
}

func relayUSBDatabase(destination io.Writer, path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() < 1024 || info.Size() > maxPlayerDatabaseBytes {
		return errors.New("player database is linked or outside the supported size range")
	}
	input, err := os.Open(path)
	if err != nil {
		return err
	}
	defer input.Close()
	opened, err := input.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return errors.New("player database changed while it was being read")
	}
	n, err := io.Copy(destination, io.LimitReader(input, maxPlayerDatabaseBytes+1))
	if err != nil {
		return err
	}
	if n != info.Size() {
		return errors.New("player database changed while it was being read")
	}
	return nil
}

func requestMergedDatabases(ctx context.Context, client *http.Client, c connection, target, stage string) (string, error) {
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
			err = relayUSBDatabase(part, filepath.Join(target, "PIONEER", "rekordbox", name))
			if err != nil {
				return
			}
		}
		err = form.Close()
	}()
	request, err := http.NewRequestWithContext(ctx, "POST", c.ServerURL+"/merge", reader)
	if err != nil {
		return "", err
	}
	request.Header.Set("X-Resonance-Link-Token", c.Token)
	request.Header.Set("Content-Type", form.FormDataContentType())
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return "", fmt.Errorf("Resonance could not merge this USB library (HTTP %d): %s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	archive := filepath.Join(stage, "merged-databases.zip")
	output, err := os.OpenFile(archive, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	n, copyErr := io.Copy(output, io.LimitReader(response.Body, 2*maxPlayerDatabaseBytes+1))
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
	if n > 2*maxPlayerDatabaseBytes {
		return "", errors.New("merged databases are too large")
	}
	return archive, nil
}

func extractMergedDatabases(archive, stage string) error {
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer reader.Close()
	if len(reader.File) != 2 {
		return errors.New("merged database response has unexpected files")
	}
	seen := map[string]bool{}
	for _, file := range reader.File {
		if file.Name != "export.pdb" && file.Name != "exportLibrary.db" {
			return errors.New("merged database response has an unexpected path")
		}
		if seen[file.Name] || !file.Mode().IsRegular() || file.UncompressedSize64 < 1024 || file.UncompressedSize64 > uint64(maxPlayerDatabaseBytes) {
			return errors.New("merged database response is invalid")
		}
		seen[file.Name] = true
		input, err := file.Open()
		if err != nil {
			return err
		}
		path := filepath.Join(stage, "merged-"+file.Name)
		output, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			input.Close()
			return err
		}
		n, copyErr := io.Copy(output, io.LimitReader(input, maxPlayerDatabaseBytes+1))
		input.Close()
		if copyErr == nil {
			copyErr = output.Sync()
		}
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if n != int64(file.UncompressedSize64) {
			return errors.New("merged database size changed")
		}
	}
	return nil
}

func fileDigest(path string) (string, error) {
	input, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer input.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, input); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func playerDatabaseDigests(root string) (map[string]string, error) {
	result := map[string]string{}
	for _, name := range []string{"export.pdb", "exportLibrary.db", "exportExt.pdb"} {
		if name == "exportExt.pdb" {
			if _, err := os.Lstat(filepath.Join(root, "PIONEER", "rekordbox", name)); errors.Is(err, os.ErrNotExist) {
				continue
			} else if err != nil {
				return nil, err
			}
		}
		digest, err := fileDigest(filepath.Join(root, "PIONEER", "rekordbox", name))
		if err != nil {
			return nil, err
		}
		result[name] = digest
	}
	return result, nil
}

func unchangedPlayerDatabases(root string, expected map[string]string) error {
	current, err := playerDatabaseDigests(root)
	if err != nil {
		return err
	}
	if len(current) != len(expected) {
		return errors.New("player database files changed during the export; close rekordbox and retry")
	}
	for name, digest := range expected {
		if current[name] != digest {
			return errors.New("player database changed during the export; close rekordbox and retry")
		}
	}
	return nil
}

func copyExclusive(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = io.Copy(output, input)
	if err == nil {
		err = output.Sync()
	}
	closeErr := output.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func publishMergedUSB(ctx context.Context, client *http.Client, c connection, prepared *usbPrepared, stage, target string, verifyMount func() error, backup *playerDatabaseBackup) (err error) {
	if backup == nil || backup.Path == "" {
		return errors.New("player databases were not backed up before the USB write")
	}
	id := prepared.Manifest.JobID
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(id) {
		return errors.New("prepare a new export before adding to an existing USB library")
	}
	for _, spec := range prepared.Manifest.Files {
		if strings.HasPrefix(spec.Path, "Contents/") && !strings.HasPrefix(spec.Path, "Contents/Resonance/"+id+"/") {
			return errors.New("this export does not use a unique USB track folder")
		}
		if !strings.HasPrefix(spec.Path, "Contents/Resonance/"+id+"/") &&
			!strings.HasPrefix(spec.Path, "PIONEER/USBANLZ/") &&
			spec.Path != "PIONEER/rekordbox/export.pdb" && spec.Path != "PIONEER/rekordbox/exportExt.pdb" && spec.Path != "PIONEER/rekordbox/exportLibrary.db" {
			return errors.New("this export contains a file Bridge cannot safely add to an existing USB library")
		}
	}
	if err = existingLibraryReady(target); err != nil {
		return err
	}
	if err = unchangedPlayerDatabases(target, backup.Digests); err != nil {
		return err
	}
	archive, err := requestMergedDatabases(ctx, client, c, target, stage)
	if err != nil {
		return err
	}
	if err = unchangedPlayerDatabases(target, backup.Digests); err != nil {
		return err
	}
	if err = extractMergedDatabases(archive, stage); err != nil {
		return err
	}
	if verifyMount != nil {
		if err = verifyMount(); err != nil {
			return err
		}
	}
	if err = existingLibraryReady(target); err != nil {
		return err
	}
	return commitMergedUSB(ctx, stage, target, id, backup.Digests, verifyMount)
}

func safeDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("USB library contains an unsafe directory")
	}
	return nil
}

func newDirectory(path string, created *[]string) error {
	if err := os.Mkdir(path, 0700); err == nil {
		*created = append(*created, path)
		return nil
	} else if !errors.Is(err, os.ErrExist) {
		return err
	}
	return safeDirectory(path)
}

func absent(path string) error {
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	return errors.New("existing USB file would be replaced")
}

func replaceFromBackup(backup, destination, id string) error {
	temporary := destination + ".resonance-restore-" + id
	if err := copyExclusive(backup, temporary); err != nil {
		return err
	}
	if err := os.Rename(temporary, destination); err != nil {
		os.Remove(temporary)
		return err
	}
	return nil
}

func rollbackMergedUSB(backup, target, id string, created []string) error {
	var first error
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		source := filepath.Join(backup, name)
		if _, err := os.Stat(source); err == nil {
			if err = replaceFromBackup(source, filepath.Join(target, "PIONEER", "rekordbox", name), id); err != nil && first == nil {
				first = err
			}
		}
	}
	if first != nil {
		return first
	}
	for i := len(created) - 1; i >= 0; i-- {
		_ = os.RemoveAll(created[i])
	}
	return os.RemoveAll(backup)
}

func commitMergedUSB(ctx context.Context, stage, target, id string, oldDigests map[string]string, verifyMount func() error) (err error) {
	if err = unchangedPlayerDatabases(target, oldDigests); err != nil {
		return err
	}
	oldDB := filepath.Join(target, "PIONEER", "rekordbox")
	audio := filepath.Join(stage, "Contents", "Resonance", id)
	if err = safeDirectory(audio); err != nil {
		return errors.New("prepared export has no unique track folder")
	}
	analysis := filepath.Join(stage, "PIONEER", "USBANLZ")
	if err = safeDirectory(analysis); err != nil {
		return errors.New("prepared export has no analysis folder")
	}
	backup := filepath.Join(target, ".resonance-rollback-"+id)
	if err = absent(backup); err != nil {
		return err
	}
	if err = os.Mkdir(backup, 0700); err != nil {
		return err
	}
	created := []string{}
	ready := false
	defer func() {
		if err == nil {
			return
		}
		if !ready {
			_ = os.RemoveAll(backup)
			return
		}
		if recovery := rollbackMergedUSB(backup, target, id, created); recovery != nil {
			err = fmt.Errorf("%w; USB recovery is required: %v", err, recovery)
		}
	}()
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		if err = copyExclusive(filepath.Join(oldDB, name), filepath.Join(backup, name)); err != nil {
			return err
		}
		var backupDigest string
		if backupDigest, err = fileDigest(filepath.Join(backup, name)); err != nil {
			return err
		}
		if backupDigest != oldDigests[name] {
			return errors.New("USB database backup readback checksum differs")
		}
	}
	if err = os.WriteFile(filepath.Join(backup, "ready"), []byte(id), 0600); err != nil {
		return err
	}
	ready = true
	if err = ctx.Err(); err != nil {
		return err
	}
	if verifyMount != nil {
		if err = verifyMount(); err != nil {
			return err
		}
	}
	resonance := filepath.Join(target, "Contents", "Resonance")
	if err = newDirectory(resonance, &created); err != nil {
		return err
	}
	newAudio := filepath.Join(resonance, id)
	if err = absent(newAudio); err != nil {
		return err
	}
	if err = os.Rename(audio, newAudio); err != nil {
		return err
	}
	created = append(created, newAudio)
	usbAnalysis := filepath.Join(target, "PIONEER", "USBANLZ")
	if err = newDirectory(usbAnalysis, &created); err != nil {
		return err
	}
	buckets, err := os.ReadDir(analysis)
	if err != nil {
		return err
	}
	for _, bucket := range buckets {
		if !bucket.IsDir() {
			return errors.New("unexpected analysis file layout")
		}
		sourceBucket := filepath.Join(analysis, bucket.Name())
		targetBucket := filepath.Join(usbAnalysis, bucket.Name())
		if err = newDirectory(targetBucket, &created); err != nil {
			return err
		}
		items, readErr := os.ReadDir(sourceBucket)
		if readErr != nil {
			return readErr
		}
		for _, item := range items {
			if !item.IsDir() {
				return errors.New("unexpected analysis file layout")
			}
			to := filepath.Join(targetBucket, item.Name())
			if err = absent(to); err != nil {
				return err
			}
			if err = os.Rename(filepath.Join(sourceBucket, item.Name()), to); err != nil {
				return err
			}
			created = append(created, to)
		}
	}
	if verifyMount != nil {
		if err = verifyMount(); err != nil {
			return err
		}
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		source := filepath.Join(stage, "merged-"+name)
		temporary := filepath.Join(oldDB, ".resonance-new-"+id+"-"+name)
		if err = copyExclusive(source, temporary); err != nil {
			return err
		}
		created = append(created, temporary)
		var want, got string
		if want, err = fileDigest(source); err != nil {
			return err
		}
		if got, err = fileDigest(temporary); err != nil {
			return err
		}
		if got != want {
			return errors.New("merged database readback checksum differs")
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
	if err = unchangedPlayerDatabases(target, oldDigests); err != nil {
		return err
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		temporary := filepath.Join(oldDB, ".resonance-new-"+id+"-"+name)
		if err = os.Rename(temporary, filepath.Join(oldDB, name)); err != nil {
			return err
		}
		var want, got string
		if want, err = fileDigest(filepath.Join(stage, "merged-"+name)); err != nil {
			return err
		}
		if got, err = fileDigest(filepath.Join(oldDB, name)); err != nil {
			return err
		}
		if got != want {
			return errors.New("merged database readback checksum differs")
		}
	}
	records := filepath.Join(target, "ResonanceExports")
	if err = newDirectory(records, &created); err != nil {
		return err
	}
	record := filepath.Join(records, id+".json")
	if err = copyExclusive(filepath.Join(stage, "export-manifest.json"), record); err != nil {
		return err
	}
	created = append(created, record)
	if err = os.WriteFile(filepath.Join(backup, "complete"), []byte(id), 0600); err != nil {
		return err
	}
	_ = os.RemoveAll(backup)
	return nil
}

func (h *helper) recoverInterruptedUSB(id string) error {
	if runtime.GOOS != "darwin" {
		return errors.New("USB export recovery is currently available on Mac")
	}
	if !h.operation.TryLock() {
		return errors.New("another Bridge operation is in progress")
	}
	defer h.operation.Unlock()
	h.mu.Lock()
	busy := h.Updating || (h.USB != nil && (h.USB.Status == "writing" || h.USB.Status == "downloading"))
	h.mu.Unlock()
	if busy {
		return errors.New("finish the current USB operation before recovery")
	}
	volume, err := h.findUSBVolume(id)
	if err != nil {
		return err
	}
	if h.bridgeUsingUSBVolume(volume) {
		return errors.New("Bridge is using files on this USB drive")
	}
	backups, err := filepath.Glob(filepath.Join(volume.Path, ".resonance-rollback-*"))
	if err != nil || len(backups) != 1 {
		return errors.New("expected one interrupted USB export to recover")
	}
	backup := backups[0]
	if err = safeDirectory(backup); err != nil {
		return err
	}
	job := strings.TrimPrefix(filepath.Base(backup), ".resonance-rollback-")
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(job) {
		return errors.New("invalid USB recovery folder")
	}
	if _, err = os.Lstat(filepath.Join(backup, "complete")); err == nil {
		return os.RemoveAll(backup)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	marker, err := os.ReadFile(filepath.Join(backup, "ready"))
	if errors.Is(err, os.ErrNotExist) {
		// The ready marker is written before any library files are touched.
		return os.RemoveAll(backup)
	}
	if err != nil || string(marker) != job {
		return errors.New("USB recovery marker is invalid")
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		info, err := os.Lstat(filepath.Join(backup, name))
		if err != nil || !info.Mode().IsRegular() || info.Size() < 1024 || info.Size() > maxPlayerDatabaseBytes {
			return errors.New("USB recovery backup is incomplete")
		}
	}
	if current, err := h.findUSBVolume(id); err != nil || current.Path != volume.Path {
		return errors.New("USB drive changed during recovery")
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		if err = replaceFromBackup(filepath.Join(backup, name), filepath.Join(volume.Path, "PIONEER", "rekordbox", name), job); err != nil {
			return err
		}
	}
	audioParent := filepath.Join(volume.Path, "Contents", "Resonance")
	if safeDirectory(filepath.Join(volume.Path, "Contents")) == nil && safeDirectory(audioParent) == nil {
		_ = os.RemoveAll(filepath.Join(audioParent, job))
	}
	if records := filepath.Join(volume.Path, "ResonanceExports"); safeDirectory(records) == nil {
		_ = os.Remove(filepath.Join(records, job+".json"))
	}
	if err = os.RemoveAll(backup); err != nil {
		return err
	}
	if h.Diagnostics != nil {
		h.Diagnostics.event("warning", "usb.recovered", map[string]any{"label": volume.Label})
	}
	return nil
}
