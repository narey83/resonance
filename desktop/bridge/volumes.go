// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode/utf16"
)

type usbVolume struct {
	ID         string `json:"id"`
	Path       string `json:"path"`
	Label      string `json:"label"`
	Filesystem string `json:"filesystem"`
	Contents   string `json:"contents"`
	Device     string `json:"-"`
	UUID       string `json:"-"`
}

func normalizeVolume(v usbVolume) (usbVolume, bool) {
	fs := strings.ToLower(v.Filesystem)
	supported := fs == "msdos" || fs == "vfat" || fs == "fat32" || fs == "exfat"
	if !supported && runtime.GOOS != "darwin" {
		return v, false
	}
	if v.Path == "" || v.UUID == "" {
		return v, false
	}
	real, e := filepath.EvalSymlinks(v.Path)
	if e != nil {
		return v, false
	}
	v.Path = real
	hash := sha256.Sum256([]byte(v.Path + "\x00" + v.Device + "\x00" + v.UUID + "\x00" + fs))
	v.ID = hex.EncodeToString(hash[:])
	if v.Label == "" {
		v.Label = filepath.Base(v.Path)
	}
	if supported {
		v.Contents = inspectUSBContents(v.Path)
	} else {
		v.Contents = "unsupported"
	}
	return v, true
}

// Classify only the mounted volume root. Existing player libraries are never
// interpreted as empty destinations, even if one database is missing or broken.
func inspectUSBContents(root string) string {
	entries, err := os.ReadDir(root)
	if err != nil {
		return "unreadable"
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".resonance-rollback-") {
			return "recovery-needed"
		}
	}
	allowed := map[string]bool{".spotlight-v100": true, ".trashes": true, ".fseventsd": true, ".ds_store": true, "system volume information": true, "$recycle.bin": true, ".temporaryitems": true, ".volumeicon.icns": true}
	occupied := false
	for _, entry := range entries {
		if !allowed[strings.ToLower(entry.Name())] {
			occupied = true
			break
		}
	}
	if !occupied {
		return "empty"
	}
	player := filepath.Join(root, "PIONEER", "rekordbox")
	for _, path := range []string{filepath.Join(root, "PIONEER"), player} {
		info, err := os.Lstat(path)
		if err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
			return "other"
		}
	}
	classic, err := os.Lstat(filepath.Join(player, "export.pdb"))
	hasClassic := err == nil && classic.Mode().IsRegular()
	one, err := os.Lstat(filepath.Join(player, "exportLibrary.db"))
	hasOne := err == nil && one.Mode().IsRegular()
	switch {
	case hasClassic && hasOne:
		return "dual-library"
	case hasClassic:
		return "classic-library"
	case hasOne:
		return "one-library"
	default:
		return "other"
	}
}
func plistValues(data []byte) map[string]string {
	d := xml.NewDecoder(bytes.NewReader(data))
	m := map[string]string{}
	key := ""
	for {
		token, e := d.Token()
		if e != nil {
			break
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		if start.Name.Local == "key" {
			d.DecodeElement(&key, &start)
		} else if key != "" {
			switch start.Name.Local {
			case "string", "integer":
				var value string
				d.DecodeElement(&value, &start)
				m[key] = value
				key = ""
			case "true", "false":
				m[key] = start.Name.Local
				key = ""
			}
		}
	}
	return m
}
func usbVolumes() ([]usbVolume, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out := []usbVolume{}
	appendVolume := func(v usbVolume) {
		if v, ok := normalizeVolume(v); ok {
			out = append(out, v)
		}
	}
	switch runtime.GOOS {
	case "darwin":
		entries, e := os.ReadDir("/Volumes")
		if e != nil {
			return nil, e
		}
		for _, entry := range entries {
			path := filepath.Join("/Volumes", entry.Name())
			data, e := exec.CommandContext(ctx, "/usr/sbin/diskutil", "info", "-plist", path).Output()
			if e != nil {
				continue
			}
			m := plistValues(data)
			if m["Internal"] != "false" || m["BusProtocol"] != "USB" || m["MountPoint"] != path {
				continue
			}
			appendVolume(usbVolume{Path: path, Label: m["VolumeName"], Filesystem: m["FilesystemType"], Device: m["DeviceIdentifier"], UUID: m["VolumeUUID"]})
		}
	case "linux":
		data, e := exec.CommandContext(ctx, "lsblk", "--json", "--output", "PATH,MOUNTPOINT,FSTYPE,RM,HOTPLUG,TRAN,UUID,LABEL").Output()
		if e != nil {
			return nil, errors.New("could not read mounted USB drives with lsblk")
		}
		type block struct {
			Path     string            `json:"path"`
			Mount    string            `json:"mountpoint"`
			FS       string            `json:"fstype"`
			RM       bool              `json:"rm"`
			Hot      bool              `json:"hotplug"`
			Tran     string            `json:"tran"`
			UUID     string            `json:"uuid"`
			Label    string            `json:"label"`
			Children []json.RawMessage `json:"children"`
		}
		var listing struct {
			Devices []json.RawMessage `json:"blockdevices"`
		}
		if e = json.Unmarshal(data, &listing); e != nil {
			return nil, e
		}
		var walk func(json.RawMessage, bool)
		walk = func(raw json.RawMessage, parent bool) {
			var b block
			if json.Unmarshal(raw, &b) != nil {
				return
			}
			removable := parent || b.RM || b.Hot || b.Tran == "usb"
			if removable && b.Mount != "" {
				appendVolume(usbVolume{Path: b.Mount, Label: b.Label, Filesystem: b.FS, Device: b.Path, UUID: b.UUID})
			}
			for _, child := range b.Children {
				walk(child, removable)
			}
		}
		for _, raw := range listing.Devices {
			walk(raw, false)
		}
	case "windows":
		script := `$items=@(Get-Volume | Where-Object {$_.DriveLetter} | ForEach-Object {$v=$_;try{$p=Get-Partition -DriveLetter $v.DriveLetter -ErrorAction Stop;$d=Get-Disk -Number $p.DiskNumber -ErrorAction Stop;if($d.BusType -eq 'USB'){[pscustomobject]@{path=([string]$v.DriveLetter+':\');label=$v.FileSystemLabel;filesystem=$v.FileSystem;device=[string]$d.Number;uuid=$v.UniqueId}}}catch{}});ConvertTo-Json -InputObject $items -Compress`
		chars := utf16.Encode([]rune(script))
		encoded := make([]byte, len(chars)*2)
		for i, c := range chars {
			binary.LittleEndian.PutUint16(encoded[i*2:], c)
		}
		data, e := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.StdEncoding.EncodeToString(encoded)).Output()
		if e != nil {
			return nil, errors.New("could not read mounted USB volumes")
		}
		var list []struct {
			Path       string `json:"path"`
			Label      string `json:"label"`
			Filesystem string `json:"filesystem"`
			Device     string `json:"device"`
			UUID       string `json:"uuid"`
		}
		if e = json.Unmarshal(data, &list); e != nil {
			return nil, e
		}
		for _, v := range list {
			if strings.EqualFold(strings.TrimRight(v.Path, "\\"), os.Getenv("SystemDrive")) {
				continue
			}
			appendVolume(usbVolume{Path: v.Path, Label: v.Label, Filesystem: v.Filesystem, Device: v.Device, UUID: v.UUID})
		}
	default:
		return nil, fmt.Errorf("USB discovery is unavailable on %s", runtime.GOOS)
	}
	if ctx.Err() != nil {
		return nil, errors.New("USB drive discovery timed out; refresh and try again")
	}
	return out, nil
}
