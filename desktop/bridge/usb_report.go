// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/vynulldev/vynull/pdb"
)

type usbReportFile struct {
	Name  string `json:"name"`
	Bytes int64  `json:"bytes"`
}

type usbReportTrack struct {
	ID             uint32  `json:"id"`
	Title          string  `json:"title"`
	Artist         string  `json:"artist"`
	Album          string  `json:"album"`
	Genre          string  `json:"genre"`
	Key            string  `json:"key"`
	Label          string  `json:"label"`
	Comment        string  `json:"comment"`
	Year           uint16  `json:"year"`
	TrackNumber    uint32  `json:"trackNumber"`
	DiscNumber     uint16  `json:"discNumber"`
	BPM            float64 `json:"bpm"`
	Duration       uint16  `json:"durationSeconds"`
	Bitrate        uint32  `json:"bitrate"`
	SampleRate     uint32  `json:"sampleRate"`
	SampleDepth    uint16  `json:"sampleDepth"`
	Rating         uint8   `json:"rating"`
	PlayCount      uint16  `json:"playCount"`
	FileSize       uint32  `json:"databaseFileBytes"`
	AudioPath      string  `json:"audioPath"`
	AnalysisPath   string  `json:"analysisPath"`
	AudioStatus    string  `json:"audioStatus"`
	AnalysisStatus string  `json:"analysisStatus"`
}

type usbReportPlaylist struct {
	ID       uint32   `json:"id"`
	ParentID uint32   `json:"parentId"`
	Name     string   `json:"name"`
	IsFolder bool     `json:"isFolder"`
	TrackIDs []uint32 `json:"trackIds"`
}

type usbDriveReport struct {
	SchemaVersion  int                 `json:"schemaVersion"`
	GeneratedAt    time.Time           `json:"generatedAt"`
	DriveID        string              `json:"driveId"`
	DatabaseSHA256 string              `json:"databaseSha256"`
	Label          string              `json:"label"`
	Filesystem     string              `json:"filesystem"`
	Contents       string              `json:"contents"`
	Databases      []usbReportFile     `json:"databases"`
	Tracks         []usbReportTrack    `json:"tracks"`
	Playlists      []usbReportPlaylist `json:"playlists"`
	AudioIssues    int                 `json:"audioIssues"`
	AnalysisIssues int                 `json:"analysisIssues"`
	Notes          []string            `json:"notes"`
}

// fileStatus never follows a database-supplied path outside the selected drive.
func fileStatus(root, usbPath string, expectedBytes uint32) string {
	clean := strings.TrimPrefix(usbPath, "/")
	if clean == "" || strings.Contains(usbPath, "\\") {
		return "invalid path"
	}
	for _, part := range strings.Split(clean, "/") {
		if part == "" || part == "." || part == ".." {
			return "invalid path"
		}
	}
	path := filepath.Join(root, filepath.FromSlash(clean))
	if !onUSBVolume(root, path) {
		return "invalid path"
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(path))
	if errors.Is(err, os.ErrNotExist) {
		return "missing"
	}
	if err != nil {
		return "unreadable"
	}
	if !onUSBVolume(root, parent) {
		return "invalid path"
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return "missing"
	}
	if err != nil {
		return "unreadable"
	}
	if !info.Mode().IsRegular() || requireUnder(root, path) != nil {
		return "invalid path"
	}
	if expectedBytes > 0 && info.Size() != int64(expectedBytes) {
		return "size differs"
	}
	return "present"
}

// inspectUSBDrive reads the mounted drive itself. It does not write to the drive
// or claim that the separate encrypted OneLibrary database was parsed.
func inspectUSBDrive(volume usbVolume) (*usbDriveReport, error) {
	if volume.Contents != "classic-library" && volume.Contents != "dual-library" {
		return nil, errors.New("select a USB drive with a classic export database")
	}
	root, err := filepath.EvalSymlinks(volume.Path)
	if err != nil {
		return nil, errors.New("selected USB drive is unavailable")
	}
	dbPath := filepath.Join(root, "PIONEER", "rekordbox", "export.pdb")
	info, err := os.Lstat(dbPath)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 128<<20 || requireUnder(root, dbPath) != nil {
		return nil, errors.New("classic export database is unavailable or exceeds 128 MiB")
	}
	db, err := pdb.Open(dbPath)
	if err != nil {
		return nil, fmt.Errorf("could not read classic export database: %w", err)
	}
	digest, err := fileDigest(dbPath)
	if err != nil {
		return nil, fmt.Errorf("could not verify classic export database: %w", err)
	}
	if len(db.Tracks) > 20000 || len(db.PlaylistTree) > 10000 {
		return nil, errors.New("USB library is too large for a detailed report")
	}
	report := &usbDriveReport{SchemaVersion: 1, GeneratedAt: time.Now().UTC(), DriveID: volume.ID, DatabaseSHA256: digest,
		Label: volume.Label, Filesystem: volume.Filesystem, Contents: volume.Contents,
		Databases: []usbReportFile{{Name: "export.pdb", Bytes: info.Size()}},
		Tracks:    make([]usbReportTrack, 0, len(db.Tracks)), Playlists: make([]usbReportPlaylist, 0, len(db.PlaylistTree)),
		Notes: []string{"Track and playlist metadata comes from the classic export.pdb on this USB. Audio size is compared with the database when available; checksums and player playback are not tested."}}
	for _, name := range []string{"exportExt.pdb", "exportLibrary.db"} {
		path := filepath.Join(root, "PIONEER", "rekordbox", name)
		if file, err := os.Lstat(path); err == nil && file.Mode().IsRegular() && requireUnder(root, path) == nil {
			report.Databases = append(report.Databases, usbReportFile{Name: name, Bytes: file.Size()})
		}
	}
	if volume.Contents == "dual-library" {
		report.Notes = append(report.Notes, "OneLibrary is present but its contents are not decoded by this report; counts and playlists below describe the classic database only.")
	}
	for _, track := range db.Tracks {
		audio := fileStatus(root, track.FilePath, track.FileSize)
		analysis := fileStatus(root, track.AnalyzePath, 0)
		if audio != "present" {
			report.AudioIssues++
		}
		if analysis != "present" {
			report.AnalysisIssues++
		}
		report.Tracks = append(report.Tracks, usbReportTrack{ID: track.ID, Title: track.Title, Artist: track.Artist,
			Album: track.Album, Genre: track.Genre, Key: track.Key, Label: track.Label, Comment: track.Comment,
			Year: track.Year, TrackNumber: track.TrackNum, DiscNumber: track.DiscNumber,
			BPM: float64(track.Tempo) / 100, Duration: track.Duration, Bitrate: track.Bitrate,
			SampleRate: track.SampleRate, SampleDepth: track.SampleDepth, Rating: track.Rating,
			PlayCount: track.PlayCount, FileSize: track.FileSize, AudioPath: track.FilePath,
			AnalysisPath: track.AnalyzePath, AudioStatus: audio, AnalysisStatus: analysis})
	}
	for _, node := range db.PlaylistTree {
		ids := append([]uint32{}, node.TrackIDs...)
		report.Playlists = append(report.Playlists, usbReportPlaylist{ID: node.ID, ParentID: node.ParentID,
			Name: node.Name, IsFolder: node.IsFolder, TrackIDs: ids})
	}
	return report, nil
}
