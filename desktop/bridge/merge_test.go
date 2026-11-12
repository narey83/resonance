// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func copyTestTree(t *testing.T, source, target string) {
	t.Helper()
	err := filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0700)
		}
		if !entry.Type().IsRegular() {
			return errors.New("test fixture contains a special file")
		}
		return copyExclusive(path, destination)
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestUSBMergeStreamsIntoExistingRekordboxFixture(t *testing.T) {
	fixture := os.Getenv("RESONANCE_TEST_MERGE_FIXTURE")
	if fixture == "" {
		t.Skip("set genuine rekordbox merge fixture")
	}
	manifest := filepath.Join(fixture, "prepared", "export-manifest.json")
	mergeArchive := filepath.Join(fixture, "merged.zip")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Resonance-Link-Token") != strings.Repeat("b", 64) {
			w.WriteHeader(401)
			return
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/manifest"):
			http.ServeFile(w, r, manifest)
		case strings.HasSuffix(r.URL.Path, "/file"):
			http.ServeFile(w, r, filepath.Join(fixture, "prepared", filepath.FromSlash(r.URL.Query().Get("path"))))
		case strings.HasSuffix(r.URL.Path, "/merge"):
			if err := r.ParseMultipartForm(270000000); err != nil {
				w.WriteHeader(400)
				return
			}
			for _, field := range []string{"classic", "oneLibrary"} {
				file, _, err := r.FormFile(field)
				if err != nil {
					w.WriteHeader(400)
					return
				}
				data, err := io.ReadAll(io.LimitReader(file, maxPlayerDatabaseBytes+1))
				file.Close()
				if err != nil || len(data) < 1024 {
					w.WriteHeader(400)
					return
				}
			}
			http.ServeFile(w, r, mergeArchive)
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	connection := connection{ServerURL: server.URL + "/transfer/" + strings.Repeat("a", 32), Token: strings.Repeat("b", 64)}
	prepared, err := downloadUSBManifest(context.Background(), server.Client(), connection)
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"success", "rollback", "backup-failure", "symlink-backup"} {
		t.Run(scenario, func(t *testing.T) {
			target, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			copyTestTree(t, filepath.Join(fixture, "existing"), target)
			oldClassic, _ := fileDigest(filepath.Join(target, "PIONEER/rekordbox/export.pdb"))
			oldModern, _ := fileDigest(filepath.Join(target, "PIONEER/rekordbox/exportLibrary.db"))
			oldExtended, _ := fileDigest(filepath.Join(target, "PIONEER/rekordbox/exportExt.pdb"))
			oldAudio, _ := fileDigest(filepath.Join(target, "Contents/UnknownArtist/UnknownAlbum/NOISE.wav"))
			calls := 0
			check := func() error {
				calls++
				if scenario == "rollback" && calls == 5 {
					return errors.New("USB disconnected")
				}
				return nil
			}
			backupRoot := t.TempDir()
			if scenario == "backup-failure" {
				backupRoot = filepath.Join(target, "Contents")
			}
			if scenario == "symlink-backup" {
				if err := os.Symlink(target, filepath.Join(backupRoot, "usb-db-backups")); err != nil {
					t.Fatal(err)
				}
			}
			var databaseBackup string
			err = writeUSBStreamMode(context.Background(), prepared, connection, target, check, nil, true, backupRoot, func(path string) {
				databaseBackup = path
				if stage, _ := filepath.Glob(filepath.Join(target, ".resonance-usb-*")); len(stage) != 0 {
					t.Fatal("USB staging began before the database backup completed")
				}
			})
			if scenario == "backup-failure" || scenario == "symlink-backup" {
				if err == nil || databaseBackup != "" {
					t.Fatal("unsafe backup location was accepted")
				}
				if stage, _ := filepath.Glob(filepath.Join(target, ".resonance-usb-*")); len(stage) != 0 {
					t.Fatal("backup failure wrote to USB")
				}
				classic, _ := fileDigest(filepath.Join(target, "PIONEER/rekordbox/export.pdb"))
				modern, _ := fileDigest(filepath.Join(target, "PIONEER/rekordbox/exportLibrary.db"))
				if classic != oldClassic || modern != oldModern {
					t.Fatal("backup failure changed an original database")
				}
				return
			}
			if databaseBackup == "" {
				t.Fatal("USB write started without a verified off-drive database backup")
			}
			for _, name := range []string{"export.pdb", "exportLibrary.db", "exportExt.pdb"} {
				copied, copyErr := fileDigest(filepath.Join(databaseBackup, name))
				want := oldClassic
				if name == "exportLibrary.db" {
					want = oldModern
				}
				if name == "exportExt.pdb" {
					want = oldExtended
				}
				if copyErr != nil || copied != want {
					t.Fatal("off-drive backup differs from original", name, copyErr)
				}
			}
			if scenario == "rollback" {
				if err == nil {
					t.Fatal("disconnected USB was committed")
				}
				classic, _ := fileDigest(filepath.Join(target, "PIONEER/rekordbox/export.pdb"))
				modern, _ := fileDigest(filepath.Join(target, "PIONEER/rekordbox/exportLibrary.db"))
				if classic != oldClassic || modern != oldModern {
					t.Fatal("rollback changed existing database")
				}
				if pending, _ := filepath.Glob(filepath.Join(target, ".resonance-rollback-*")); len(pending) != 0 {
					t.Fatal("rollback folder remains")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			newClassic, _ := fileDigest(filepath.Join(target, "PIONEER/rekordbox/export.pdb"))
			newModern, _ := fileDigest(filepath.Join(target, "PIONEER/rekordbox/exportLibrary.db"))
			wantClassic, _ := fileDigest(filepath.Join(fixture, "merged/export.pdb"))
			wantModern, _ := fileDigest(filepath.Join(fixture, "merged/exportLibrary.db"))
			unchangedAudio, _ := fileDigest(filepath.Join(target, "Contents/UnknownArtist/UnknownAlbum/NOISE.wav"))
			if newClassic != wantClassic || newModern != wantModern || unchangedAudio != oldAudio {
				t.Fatal("merged databases or existing audio changed unexpectedly")
			}
			if _, err := os.Stat(filepath.Join(target, "Contents/Resonance", strings.Repeat("a", 32), "00001-track.wav")); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Join(target, "ResonanceExports", strings.Repeat("a", 32)+".json")); err != nil {
				t.Fatal(err)
			}
			if pending, _ := filepath.Glob(filepath.Join(target, ".resonance-rollback-*")); len(pending) != 0 {
				t.Fatal("completed backup remains")
			}
		})
	}
}
