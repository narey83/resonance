// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vynulldev/vynull/pdb"
)

type reportTestDevices struct{ volume usbVolume }

func (d reportTestDevices) List() ([]usbVolume, error)            { return []usbVolume{d.volume}, nil }
func (reportTestDevices) Eject(context.Context, usbVolume) error  { return nil }
func (reportTestDevices) Format(context.Context, usbVolume) error { return nil }

func reportFixture(t *testing.T) usbVolume {
	t.Helper()
	root := t.TempDir()
	track := &pdb.Track{ID: 7, Title: "Stored title", Artist: "Artist", Album: "Album",
		Genre: "House", Key: "Am", Tempo: 12650, Duration: 180, FileSize: 5,
		FilePath: "/Contents/present.wav", AnalyzePath: "/PIONEER/ANLZ0000.DAT"}
	playlist := &pdb.FolderNode{ID: 1, Name: "Test set", TrackIDs: []uint32{7}}
	if err := pdb.GenerateWithOptions([]*pdb.Track{track}, []*pdb.FolderNode{playlist}, nil, nil, root); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "Contents"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Contents", "present.wav"), []byte("audio"), 0600); err != nil {
		t.Fatal(err)
	}
	return usbVolume{ID: strings.Repeat("a", 64), Path: root, Label: "Test USB", Filesystem: "exfat", Contents: "classic-library"}
}

func TestUSBReportReadsMountedDatabaseAndFilePresence(t *testing.T) {
	volume := reportFixture(t)
	report, err := inspectUSBDrive(volume)
	if err != nil {
		t.Fatal(err)
	}
	if report.Label != "Test USB" || len(report.Tracks) != 1 || len(report.Playlists) != 1 {
		t.Fatalf("unexpected report: %#v", report)
	}
	if report.Tracks[0].Title != "Stored title" || report.Tracks[0].BPM != 126.5 || report.Tracks[0].AudioStatus != "present" || report.Tracks[0].AnalysisStatus != "missing" {
		t.Fatalf("track report differs from USB: %#v", report.Tracks[0])
	}
	if report.AudioIssues != 0 || report.AnalysisIssues != 1 || report.Playlists[0].TrackIDs[0] != 7 {
		t.Fatalf("incorrect report counts or order: %#v", report)
	}
	if got := fileStatus(volume.Path, "/../private/secret", 0); got != "invalid path" {
		t.Fatalf("path traversal was accepted: %s", got)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(volume.Path, "Contents", "outside")); err == nil {
		if got := fileStatus(volume.Path, "/Contents/outside/file.wav", 0); got != "invalid path" {
			t.Fatalf("symlink escape was accepted: %s", got)
		}
	}
	if got := fileStatus(volume.Path, "/Contents/present.wav", 7); got != "size differs" {
		t.Fatalf("size mismatch was hidden: %s", got)
	}
}

func TestUSBReportRouteUsesCurrentDriveIdentity(t *testing.T) {
	volume := reportFixture(t)
	h := &helper{usbDevices: reportTestDevices{volume: volume}}
	for _, scenario := range []struct {
		name, id string
		status   int
	}{
		{"valid", volume.ID, http.StatusOK},
		{"invalid", "../../etc/passwd", http.StatusBadRequest},
		{"stale", strings.Repeat("b", 64), http.StatusConflict},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "http://127.0.0.1:55460/api/usb/report?id="+scenario.id, nil)
			w := httptest.NewRecorder()
			mux := http.NewServeMux()
			h.usbRoutes(mux)
			mux.ServeHTTP(w, r)
			if w.Code != scenario.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if scenario.status == http.StatusOK {
				var report usbDriveReport
				if err := json.Unmarshal(w.Body.Bytes(), &report); err != nil || report.DriveID != volume.ID {
					t.Fatalf("wrong report: %v %#v", err, report)
				}
			}
		})
	}
}
