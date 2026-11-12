// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vynulldev/vynull/pdb"
)

func editTestFiles(t *testing.T) (string, string, map[string]string, *usbEditPlan) {
	t.Helper()
	root := t.TempDir()
	stage := t.TempDir()
	db := filepath.Join(root, "PIONEER", "rekordbox")
	if err := os.MkdirAll(db, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		if err := os.WriteFile(filepath.Join(db, name), []byte(strings.Repeat("old-"+name, 200)), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(stage, "edited-"+name), []byte(strings.Repeat("new-"+name, 200)), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for path, data := range map[string]string{
		"Contents/Test/noise.wav":                        "audio",
		"PIONEER/USBANLZ/Test/noise/ANLZ0000.DAT": "analysis",
	} {
		full := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	digests, err := playerDatabaseDigests(root)
	if err != nil {
		t.Fatal(err)
	}
	plan := &usbEditPlan{Kind: "track", TargetID: 1, DeletedTrackIDs: []uint32{1},
		RemovedFiles: []string{"/Contents/Test/noise.wav", "/PIONEER/USBANLZ/Test/noise/ANLZ0000.DAT"}}
	return root, stage, digests, plan
}

func TestCommitUSBEditRemovesFilesAndPublishesDatabases(t *testing.T) {
	root, stage, digests, plan := editTestFiles(t)
	if err := commitUSBEdit(context.Background(), root, stage, strings.Repeat("a", 32), digests, plan, nil); err != nil {
		t.Fatal(err)
	}
	for _, path := range plan.RemovedFiles {
		relative, _ := usbEditRelative(path)
		if _, err := os.Lstat(filepath.Join(root, relative)); !os.IsNotExist(err) {
			t.Fatalf("deleted file remained: %s (%v)", path, err)
		}
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		data, err := os.ReadFile(filepath.Join(root, "PIONEER", "rekordbox", name))
		if err != nil || !strings.HasPrefix(string(data), "new-") {
			t.Fatalf("edited database was not published: %s (%v)", name, err)
		}
	}
	if got := inspectUSBContents(root); got != "dual-library" {
		t.Fatal(got)
	}
}

func TestCommitUSBEditRollsBackWhenDatabaseStageIsIncomplete(t *testing.T) {
	root, stage, digests, plan := editTestFiles(t)
	if err := os.Remove(filepath.Join(stage, "edited-exportLibrary.db")); err != nil {
		t.Fatal(err)
	}
	if err := commitUSBEdit(context.Background(), root, stage, strings.Repeat("b", 32), digests, plan, nil); err == nil {
		t.Fatal("incomplete edit was accepted")
	}
	if err := unchangedPlayerDatabases(root, digests); err != nil {
		t.Fatal("original databases were not restored", err)
	}
	for _, path := range plan.RemovedFiles {
		relative, _ := usbEditRelative(path)
		if _, err := os.Stat(filepath.Join(root, relative)); err != nil {
			t.Fatalf("deleted file was not restored: %s (%v)", path, err)
		}
	}
	if got := inspectUSBContents(root); got != "dual-library" {
		t.Fatal(got)
	}
}

func TestRecoverInterruptedUSBEditRestoresBothDatabasesAndFiles(t *testing.T) {
	root, stage, digests, plan := editTestFiles(t)
	id := strings.Repeat("c", 32)
	working := filepath.Join(root, ".resonance-edit-"+id)
	if err := os.Mkdir(working, 0700); err != nil {
		t.Fatal(err)
	}
	db := filepath.Join(root, "PIONEER", "rekordbox")
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		if err := copyExclusive(filepath.Join(db, name), filepath.Join(working, name)); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(filepath.Join(stage, "edited-"+name), filepath.Join(db, name)); err != nil {
			t.Fatal(err)
		}
	}
	manifest, err := json.Marshal(usbEditRecovery{ID: id, RemovedFiles: plan.RemovedFiles})
	if err != nil {
		t.Fatal(err)
	}
	if err := syncUSBEditFile(filepath.Join(working, "manifest.json"), manifest); err != nil {
		t.Fatal(err)
	}
	if err := syncUSBEditFile(filepath.Join(working, "ready"), []byte(id)); err != nil {
		t.Fatal(err)
	}
	for _, path := range plan.RemovedFiles {
		relative, _ := usbEditRelative(path)
		quarantined := filepath.Join(working, "files", relative)
		if err := os.MkdirAll(filepath.Dir(quarantined), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(filepath.Join(root, relative), quarantined); err != nil {
			t.Fatal(err)
		}
	}
	h := &helper{}
	if handled, err := h.recoverInterruptedUSBEdit(usbVolume{Path: root}); !handled || err != nil {
		t.Fatalf("recovery failed: handled=%v err=%v", handled, err)
	}
	if err := unchangedPlayerDatabases(root, digests); err != nil {
		t.Fatal("original databases were not restored", err)
	}
	for _, path := range plan.RemovedFiles {
		relative, _ := usbEditRelative(path)
		if _, err := os.Stat(filepath.Join(root, relative)); err != nil {
			t.Fatalf("deleted file was not restored: %s (%v)", path, err)
		}
	}
	if got := inspectUSBContents(root); got != "dual-library" {
		t.Fatal(got)
	}
}

func TestExtractEditedDatabasesAcceptsLargePlaylistPlan(t *testing.T) {
	stage := t.TempDir()
	archive := filepath.Join(stage, "edited.zip")
	output, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(output)
	for _, name := range []string{"export.pdb", "exportLibrary.db"} {
		part, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte(strings.Repeat("database", 128))); err != nil {
			t.Fatal(err)
		}
	}
	plan := usbEditPlan{Kind: "playlist", TargetID: 1}
	for index := range 12000 {
		plan.RemovedFiles = append(plan.RemovedFiles, "/Contents/"+strings.Repeat("a", 180)+"/"+fmt.Sprint(index)+".wav")
	}
	data, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) <= 2<<20 {
		t.Fatal("fixture did not exceed the old plan limit")
	}
	part, err := writer.Create("plan.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := output.Close(); err != nil {
		t.Fatal(err)
	}
	got, err := extractEditedDatabases(archive, stage)
	if err != nil || len(got.RemovedFiles) != len(plan.RemovedFiles) {
		t.Fatalf("large playlist plan was rejected: %v", err)
	}
}

func TestUSBEditPlanRejectsUnexpectedFilesAndAcceptsMatchingCatalog(t *testing.T) {
	root := t.TempDir()
	stage := t.TempDir()
	noise := &pdb.Track{ID: 1, Title: "NOISE", FilePath: "/Contents/Test/noise.wav", AnalyzePath: "/PIONEER/USBANLZ/Test/noise/ANLZ0000.DAT"}
	other := &pdb.Track{ID: 2, Title: "Other", FilePath: "/Contents/Test/other.wav", AnalyzePath: "/PIONEER/USBANLZ/Test/other/ANLZ0000.DAT"}
	playlist := &pdb.FolderNode{ID: 3, Name: "Set", TrackIDs: []uint32{2}}
	if err := pdb.GenerateWithOptions([]*pdb.Track{noise, other}, []*pdb.FolderNode{playlist}, nil, nil, root); err != nil {
		t.Fatal(err)
	}
	if err := pdb.GenerateWithOptions([]*pdb.Track{other}, []*pdb.FolderNode{playlist}, nil, nil, stage); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(stage, "PIONEER", "rekordbox", "export.pdb"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stage, "edited-export.pdb"), data, 0600); err != nil {
		t.Fatal(err)
	}
	request := usbEditRequest{Kind: "track", TargetID: 1}
	plan := &usbEditPlan{Kind: "track", TargetID: 1, DeletedTrackIDs: []uint32{1},
		RemovedFiles: []string{noise.FilePath, noise.AnalyzePath}}
	if err := validateUSBEditPlan(root, request, plan, stage); err != nil {
		t.Fatal(err)
	}
	plan.RemovedFiles[0] = "/PIONEER/rekordbox/export.pdb"
	if err := validateUSBEditPlan(root, request, plan, stage); err == nil {
		t.Fatal("unexpected database deletion path was accepted")
	}
}
