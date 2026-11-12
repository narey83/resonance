// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const formattedUSBLabel = "RESONANCE"

// Formatting is deliberately restricted to macOS until the other platforms
// have equivalent whole-disk identity checks and recovery tests.
func formatUSBOnPlatform(ctx context.Context, platform string, volume usbVolume, run deviceCommand) error {
	if platform != "darwin" {
		return fmt.Errorf("USB formatting is not yet available on %s", platform)
	}
	data, err := run(ctx, "/usr/sbin/diskutil", "info", "-plist", volume.Path)
	if err != nil {
		return errors.New("could not recheck this USB drive; refresh the drive list")
	}
	info := plistValues(data)
	if info["Internal"] != "false" || info["BusProtocol"] != "USB" || info["VolumeUUID"] != volume.UUID || info["DeviceIdentifier"] != volume.Device || info["MountPoint"] != volume.Path {
		return errors.New("USB drive identity changed; refresh the drive list")
	}
	disk := info["ParentWholeDisk"]
	if !regexp.MustCompile(`^disk[0-9]+$`).MatchString(disk) {
		return errors.New("could not identify the external USB disk")
	}
	data, err = run(ctx, "/usr/sbin/diskutil", "info", "-plist", "/dev/"+disk)
	if err != nil {
		return errors.New("could not recheck the external USB disk")
	}
	whole := plistValues(data)
	if whole["Internal"] != "false" || whole["BusProtocol"] != "USB" || whole["WholeDisk"] != "true" || whole["DeviceIdentifier"] != disk {
		return errors.New("the selected device is not an external USB disk")
	}
	data, err = run(ctx, "/usr/sbin/diskutil", "list", "-plist", "/dev/"+disk)
	if err != nil {
		return errors.New("could not inspect the USB disk partitions")
	}
	devices, err := plistStringArray(data, "AllDisks")
	if err != nil || len(devices) != 2 || devices[0] != disk || devices[1] != volume.Device {
		return errors.New("formatting a multi-partition USB disk is blocked to protect other volumes")
	}
	output, err := run(ctx, "/usr/sbin/diskutil", "eraseDisk", "FAT32", formattedUSBLabel, "MBRFormat", "/dev/"+disk)
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return errors.New("USB format timed out; check Disk Utility before using this drive")
	}
	detail := strings.TrimSpace(string(output))
	if len(detail) > 500 {
		detail = detail[len(detail)-500:]
	}
	if detail == "" {
		return errors.New("the operating system could not format this USB drive; close apps using it and try again")
	}
	return fmt.Errorf("USB format failed: %s", detail)
}

func plistStringArray(data []byte, key string) ([]string, error) {
	decoder := xml.NewDecoder(strings.NewReader(string(data)))
	selected := false
	for {
		token, err := decoder.Token()
		if err != nil {
			return nil, errors.New("USB partition list is invalid")
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "key" {
			continue
		}
		var found string
		if err := decoder.DecodeElement(&found, &start); err != nil {
			return nil, err
		}
		if found == key {
			selected = true
			break
		}
	}
	if !selected {
		return nil, errors.New("USB partition list is missing")
	}
	for {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		if whitespace, ok := token.(xml.CharData); ok && strings.TrimSpace(string(whitespace)) == "" {
			continue
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "array" {
			return nil, errors.New("USB partition list is invalid")
		}
		break
	}
	values := []string{}
	for {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		switch element := token.(type) {
		case xml.EndElement:
			if element.Name.Local == "array" {
				return values, nil
			}
		case xml.StartElement:
			if element.Name.Local != "string" {
				return nil, errors.New("USB partition list is invalid")
			}
			var value string
			if err := decoder.DecodeElement(&value, &element); err != nil {
				return nil, err
			}
			values = append(values, value)
		}
	}
}

func (h *helper) formatUSB(ctx context.Context, id, confirmation string) (string, error) {
	if !h.operation.TryLock() {
		return "", errors.New("another Bridge operation is in progress")
	}
	defer h.operation.Unlock()
	h.mu.Lock()
	busy := h.Updating || (h.USB != nil && (h.USB.Status == "writing" || h.USB.Status == "downloading"))
	h.mu.Unlock()
	if busy {
		return "", errors.New("finish or cancel the current USB transfer before formatting")
	}
	volume, err := h.findUSBVolume(id)
	if err != nil {
		return "", err
	}
	if confirmation != "ERASE "+volume.Label {
		return "", errors.New("type the exact drive name to confirm erasing the entire USB disk")
	}
	if h.bridgeUsingUSBVolume(volume) {
		return "", errors.New("Bridge is using files on this drive; stop sharing before formatting")
	}
	backupPath, err := h.backupBeforeFormat(volume)
	if err != nil {
		return "", err
	}
	if err = h.usbDeviceManager().Format(ctx, volume); err != nil {
		return backupPath, err
	}
	if h.Diagnostics != nil {
		h.Diagnostics.event("info", "usb.formatted", map[string]any{"label": volume.Label, "filesystem": "FAT32", "databaseBackup": backupPath})
	}
	return backupPath, nil
}

// Formatting can erase player metadata too. Preserve every recognized database
// file off the USB, including single-library and extended rekordbox databases.
func (h *helper) backupBeforeFormat(volume usbVolume) (string, error) {
	root, err := os.Lstat(volume.Path)
	if err != nil || !root.IsDir() || root.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("USB mount changed before database backup")
	}
	playerRoot := filepath.Join(volume.Path, "PIONEER")
	if err := safeDirectory(playerRoot); errors.Is(err, os.ErrNotExist) {
		return "", nil
	} else if err != nil {
		return "", errors.New("USB player database directory is unsafe")
	}
	dir := filepath.Join(volume.Path, "PIONEER", "rekordbox")
	info, err := os.Lstat(dir)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("USB player database directory is unsafe")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	names := []string{}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasSuffix(name, ".db") || strings.HasSuffix(name, ".pdb") {
			names = append(names, name)
		}
		if strings.HasSuffix(name, "-wal") || strings.HasSuffix(name, "-shm") || strings.HasSuffix(name, "-journal") {
			return "", errors.New("rekordbox has an open database journal on this USB; close it and eject cleanly before formatting")
		}
	}
	if len(names) == 0 {
		return "", nil
	}
	var raw [16]byte
	if _, err = rand.Read(raw[:]); err != nil {
		return "", err
	}
	backup, err := backupNamedPlayerDatabases(volume.Path, h.Cache, hex.EncodeToString(raw[:]), names, func() error {
		current, checkErr := h.findUSBVolume(volume.ID)
		if checkErr != nil || current.Path != volume.Path {
			return errors.New("USB drive changed during database backup")
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return backup.Path, nil
}
