// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUSBFormatRequiresExactDriveConfirmation(t *testing.T) {
	h, devices, volume := ejectFixture(t)
	for _, confirmation := range []string{"", "ERASE", "ERASE Another USB", "erase " + volume.Label} {
		result := workspaceRequest(h, "POST", "/api/usb/format", `{"id":"`+volume.ID+`","confirmation":"`+confirmation+`"}`)
		if result.Code != 409 || devices.formats != 0 {
			t.Fatalf("format accepted %q: %d", confirmation, result.Code)
		}
	}
	h.USB = &usbTransfer{Status: "writing"}
	if result := workspaceRequest(h, "POST", "/api/usb/format", `{"id":"`+volume.ID+`","confirmation":"ERASE `+volume.Label+`"}`); result.Code != 409 {
		t.Fatal("active transfer was formatted", result.Code)
	}
	h.USB = nil
	h.Cache = volume.Path
	if result := workspaceRequest(h, "POST", "/api/usb/format", `{"id":"`+volume.ID+`","confirmation":"ERASE `+volume.Label+`"}`); result.Code != 409 {
		t.Fatal("Bridge cache was formatted", result.Code)
	}
	h.Cache = t.TempDir()
	result := workspaceRequest(h, "POST", "/api/usb/format", `{"id":"`+volume.ID+`","confirmation":"ERASE `+volume.Label+`"}`)
	if result.Code != 200 || devices.formats != 1 {
		t.Fatal(result.Code, result.Body.String(), devices.formats)
	}
}

func TestUSBFormatBacksUpPlayerDatabasesBeforeErase(t *testing.T) {
	h, devices, volume := ejectFixture(t)
	h.Cache = t.TempDir()
	dir := filepath.Join(volume.Path, "PIONEER", "rekordbox")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"export.pdb", "exportLibrary.db", "exportExt.pdb"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("sample player metadata "+name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	devices.format = func(context.Context, usbVolume) error {
		for _, name := range []string{"export.pdb", "exportLibrary.db", "exportExt.pdb"} {
			backups, err := filepath.Glob(filepath.Join(h.Cache, "usb-db-backups", "*", name))
			if err != nil || len(backups) != 1 {
				t.Fatalf("database %s was not backed up before format: %v", name, err)
			}
			original, _ := os.ReadFile(filepath.Join(dir, name))
			copy, _ := os.ReadFile(backups[0])
			if string(copy) != string(original) {
				t.Fatalf("database %s backup differs", name)
			}
		}
		return nil
	}
	result := workspaceRequest(h, "POST", "/api/usb/format", `{"id":"`+volume.ID+`","confirmation":"ERASE `+volume.Label+`"}`)
	if result.Code != 200 || devices.formats != 1 || !strings.Contains(result.Body.String(), "databaseBackup") {
		t.Fatal(result.Code, result.Body.String(), devices.formats)
	}
}

func TestUSBFormatBlocksIfDatabaseBackupFails(t *testing.T) {
	h, devices, volume := ejectFixture(t)
	h.Cache = filepath.Join(t.TempDir(), "missing-cache")
	dir := filepath.Join(volume.Path, "PIONEER", "rekordbox")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "export.pdb"), []byte("sample player metadata"), 0600); err != nil {
		t.Fatal(err)
	}
	result := workspaceRequest(h, "POST", "/api/usb/format", `{"id":"`+volume.ID+`","confirmation":"ERASE `+volume.Label+`"}`)
	if result.Code != 409 || devices.formats != 0 {
		t.Fatal(result.Code, result.Body.String(), devices.formats)
	}
}

func TestMacFormatChecksWholeExternalUSBIdentity(t *testing.T) {
	volume := usbVolume{Path: "/Volumes/Test USB", Device: "disk4s1", UUID: "known"}
	for _, change := range []string{"", "uuid", "internal", "bus", "parent", "whole", "multi", "busy"} {
		t.Run(change, func(t *testing.T) {
			var calls [][]string
			run := func(_ context.Context, name string, args ...string) ([]byte, error) {
				calls = append(calls, append([]string{name}, args...))
				if args[0] == "list" {
					other := ""
					if change == "multi" {
						other = "<string>disk4s2</string>"
					}
					return []byte(`<?xml version="1.0"?><plist><dict><key>AllDisks</key><array><string>disk4</string><string>disk4s1</string>` + other + `</array></dict></plist>`), nil
				}
				if args[0] == "eraseDisk" {
					if change == "busy" {
						return []byte("Resource busy"), errors.New("exit 1")
					}
					return nil, nil
				}
				if args[len(args)-1] == volume.Path {
					info := map[string]string{"Internal": "false", "BusProtocol": "USB", "VolumeUUID": "known", "DeviceIdentifier": "disk4s1", "MountPoint": volume.Path, "ParentWholeDisk": "disk4"}
					switch change {
					case "uuid":
						info["VolumeUUID"] = "different"
					case "internal":
						info["Internal"] = "true"
					case "bus":
						info["BusProtocol"] = "SATA"
					case "parent":
						info["ParentWholeDisk"] = "disk0;rm -rf /"
					}
					return testPlist(info), nil
				}
				info := map[string]string{"Internal": "false", "BusProtocol": "USB", "WholeDisk": "true", "DeviceIdentifier": "disk4"}
				if change == "whole" {
					info["WholeDisk"] = "false"
				}
				return testPlist(info), nil
			}
			err := formatUSBOnPlatform(context.Background(), "darwin", volume, run)
			if change == "" {
				if err != nil || len(calls) != 4 || strings.Join(calls[3], " ") != "/usr/sbin/diskutil eraseDisk FAT32 RESONANCE MBRFormat /dev/disk4" {
					t.Fatal(err, calls)
				}
			} else if err == nil || (change != "busy" && len(calls) == 4) {
				t.Fatal("unsafe or failed format accepted", change, err, calls)
			}
		})
	}
	if err := formatUSBOnPlatform(context.Background(), "linux", volume, func(context.Context, string, ...string) ([]byte, error) {
		t.Fatal("platform command executed")
		return nil, nil
	}); err == nil {
		t.Fatal("unsupported platform accepted")
	}
}
