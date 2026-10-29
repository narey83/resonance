// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/vynulldev/vynull/dbserver"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf16"
)

type fakeUSBDevices struct {
	mu      sync.Mutex
	volumes []usbVolume
	eject   func(context.Context, usbVolume) error
	calls   int
}

func (f *fakeUSBDevices) List() ([]usbVolume, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]usbVolume{}, f.volumes...), nil
}
func (f *fakeUSBDevices) Eject(ctx context.Context, v usbVolume) error {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	if f.eject != nil {
		if err := f.eject(ctx, v); err != nil {
			return err
		}
	}
	f.mu.Lock()
	f.volumes = nil
	f.mu.Unlock()
	return nil
}
func ejectFixture(t *testing.T) (*helper, *fakeUSBDevices, usbVolume) {
	t.Helper()
	h := workspaceHelper(t)
	v := usbVolume{ID: strings.Repeat("a", 64), Path: t.TempDir(), UUID: "volume-identity", Device: "disk4s1", Label: "Test USB", Filesystem: "exfat"}
	devices := &fakeUSBDevices{volumes: []usbVolume{v}}
	h.usbDevices = devices
	return h, devices, v
}
func TestUSBEjectAllowsCompletedDrivesWithoutWriteConfirmation(t *testing.T) {
	h, devices, v := ejectFixture(t)
	h.USB = &usbTransfer{Status: "completed", Destination: v.Path, DestinationID: v.ID}
	result := workspaceRequest(h, "POST", "/api/usb/eject", `{"id":"`+v.ID+`"}`)
	if result.Code != 200 || devices.calls != 1 || h.USB.Status != "ejected" {
		t.Fatal(result.Code, result.Body.String(), devices.calls, h.USB.Status)
	}
	var response map[string]any
	json.Unmarshal(result.Body.Bytes(), &response)
	if response["ejected"] != true {
		t.Fatal(response)
	}
	if _, err := h.findUSBVolume(v.ID); err == nil {
		t.Fatal("ejected drive remained selectable")
	}
}
func TestUSBEjectRejectsTransferAndDeviceIdentityChanges(t *testing.T) {
	for _, status := range []string{"downloading", "writing"} {
		t.Run(status, func(t *testing.T) {
			h, devices, v := ejectFixture(t)
			h.USB = &usbTransfer{Status: status}
			result := workspaceRequest(h, "POST", "/api/usb/eject", `{"id":"`+v.ID+`"}`)
			if result.Code != 409 || devices.calls != 0 {
				t.Fatal("active transfer allowed ejection", result.Code)
			}
		})
	}
	h, devices, _ := ejectFixture(t)
	for _, body := range []string{`{}`, `{"id":"/dev/disk0"}`, `{"id":"` + strings.Repeat("g", 64) + `"}`, `{"id":"` + strings.Repeat("b", 64) + `"}`} {
		result := workspaceRequest(h, "POST", "/api/usb/eject", body)
		if result.Code == 200 || devices.calls != 0 {
			t.Fatal("unknown drive accepted", result.Code)
		}
	}
}
func TestUSBEjectFailureAndCachedLibraryLeaveDriveInPlace(t *testing.T) {
	h, devices, v := ejectFixture(t)
	devices.eject = func(context.Context, usbVolume) error { return errors.New("drive busy") }
	h.USB = &usbTransfer{Status: "completed", DestinationID: v.ID}
	result := workspaceRequest(h, "POST", "/api/usb/eject", `{"id":"`+v.ID+`"}`)
	if result.Code != 409 || h.USB.Status != "completed" {
		t.Fatal("failed eject was reported as success")
	}
	h.Cache = v.Path
	devices.calls = 0
	result = workspaceRequest(h, "POST", "/api/usb/eject", `{"id":"`+v.ID+`"}`)
	if result.Code != 409 || devices.calls != 0 {
		t.Fatal("Bridge ejected its own cache")
	}
}
func TestUSBEjectAndUSBWriteCannotOverlap(t *testing.T) {
	h, devices, v := ejectFixture(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	devices.eject = func(context.Context, usbVolume) error { close(entered); <-release; return nil }
	done := make(chan error, 1)
	go func() { _, err := h.ejectUSB(context.Background(), v.ID); done <- err }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("eject did not start")
	}
	result := workspaceRequest(h, "POST", "/api/usb/write", `{"id":"`+v.ID+`","confirm":true}`)
	if result.Code != 409 {
		t.Fatal("write overlapped eject", result.Code)
	}
	result = workspaceRequest(h, "POST", "/api/usb/eject", `{"id":"`+v.ID+`"}`)
	if result.Code != 409 {
		t.Fatal("two ejections overlapped")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func testPlist(values map[string]string) []byte {
	s := "<plist><dict>"
	for key, value := range values {
		s += "<key>" + key + "</key><string>" + value + "</string>"
	}
	return []byte(s + "</dict></plist>")
}
func TestMacEjectRechecksIdentityAndUsesWholeDiskWithoutForce(t *testing.T) {
	volume := usbVolume{Path: "/Volumes/Test USB", Device: "disk4s1", UUID: "known"}
	for _, failure := range []string{"", "uuid", "internal", "bus", "whole", "parent", "busy"} {
		t.Run(failure, func(t *testing.T) {
			calls := [][]string{}
			run := func(_ context.Context, name string, args ...string) ([]byte, error) {
				calls = append(calls, append([]string{name}, args...))
				if args[0] == "eject" {
					if failure == "busy" {
						return []byte("Resource busy"), errors.New("exit 1")
					}
					return nil, nil
				}
				if args[len(args)-1] == volume.Path {
					info := map[string]string{"Internal": "false", "BusProtocol": "USB", "VolumeUUID": "known", "DeviceIdentifier": "disk4s1", "MountPoint": volume.Path, "ParentWholeDisk": "disk4"}
					if failure == "uuid" {
						info["VolumeUUID"] = "replacement"
					}
					if failure == "internal" {
						info["Internal"] = "true"
					}
					if failure == "bus" {
						info["BusProtocol"] = "SATA"
					}
					if failure == "parent" {
						info["ParentWholeDisk"] = "disk4; echo unsafe"
					}
					return testPlist(info), nil
				}
				info := map[string]string{"Internal": "false", "BusProtocol": "USB", "WholeDisk": "true", "DeviceIdentifier": "disk4"}
				if failure == "whole" {
					info["Internal"] = "true"
				}
				return testPlist(info), nil
			}
			err := ejectUSBOnPlatform(context.Background(), "darwin", volume, run)
			if (err == nil) != (failure == "") {
				t.Fatal("unexpected result", failure, err)
			}
			if failure == "" && !reflect.DeepEqual(calls[len(calls)-1], []string{"/usr/sbin/diskutil", "eject", "/dev/disk4"}) {
				t.Fatal(calls)
			}
			if failure != "" && failure != "busy" {
				for _, call := range calls {
					if call[1] == "eject" {
						t.Fatal("eject called after identity check failed")
					}
				}
			}
		})
	}
}
func linuxListing(mount, uuid, other string) []byte {
	children := []map[string]any{{"path": "/dev/sdb1", "type": "part", "uuid": uuid, "mountpoints": []string{mount}}}
	if other != "" {
		children = append(children, map[string]any{"path": "/dev/sdb2", "type": "part", "uuid": "other", "mountpoints": []string{other}})
	}
	data, _ := json.Marshal(map[string]any{"blockdevices": []map[string]any{{"path": "/dev/sdb", "type": "disk", "tran": "usb", "children": children}}})
	return data
}
func TestLinuxEjectRejectsSystemAndOtherMountedVolumes(t *testing.T) {
	v := usbVolume{Path: "/media/USB", Device: "/dev/sdb1", UUID: "known"}
	if disk, err := linuxEjectDisk(linuxListing(v.Path, v.UUID, ""), v); err != nil || disk != "/dev/sdb" {
		t.Fatal(disk, err)
	}
	for _, data := range [][]byte{linuxListing(v.Path, "replacement", ""), linuxListing(v.Path, v.UUID, "/media/Other"), linuxListing(v.Path, v.UUID, "/")} {
		if _, err := linuxEjectDisk(data, v); err == nil {
			t.Fatal("unsafe disk accepted")
		}
	}
	calls := [][]string{}
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string{name}, args...))
		if name == "lsblk" {
			return linuxListing(v.Path, v.UUID, ""), nil
		}
		return nil, nil
	}
	if err := ejectUSBOnPlatform(context.Background(), "linux", v, run); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(calls[1:]) != "[[udisksctl unmount --block-device /dev/sdb1 --no-user-interaction] [udisksctl power-off --block-device /dev/sdb --no-user-interaction]]" {
		t.Fatal(calls)
	}
}
func TestUSBEjectCancellationAndUnsupportedPlatform(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	run := func(context.Context, string, ...string) ([]byte, error) { return nil, ctx.Err() }
	if err := runSafeEject(ctx, run, "diskutil", "eject", "disk4"); err == nil || !strings.Contains(err.Error(), "before unplugging") {
		t.Fatal(err)
	}
	if err := ejectUSBOnPlatform(context.Background(), "unsupported", usbVolume{}, run); err == nil {
		t.Fatal("unsupported platform accepted")
	}
}

func TestUSBEjectProtectsAnActiveNetworkLibrary(t *testing.T) {
	h, devices, v := ejectFixture(t)
	h.Session = &session{DB: &dbserver.Server{ExportRoot: v.Path}}
	if _, err := h.ejectUSB(context.Background(), v.ID); err == nil || devices.calls != 0 {
		t.Fatal("active network library was ejected")
	}
}
func TestUSBEjectRejectsUntrustedBrowserActions(t *testing.T) {
	for _, origin := range []string{"https://other.example", ""} {
		h, devices, v := ejectFixture(t)
		req := httptest.NewRequest("POST", "http://127.0.0.1:55460/api/usb/eject", strings.NewReader(`{"id":"`+v.ID+`"}`))
		if origin != "" {
			req.Header.Set("Origin", origin)
			req.Header.Set("X-Resonance-Link", "1")
		}
		result := httptest.NewRecorder()
		h.routes("127.0.0.1:55460").ServeHTTP(result, req)
		if result.Code != 403 || devices.calls != 0 {
			t.Fatal("untrusted action accepted", result.Code)
		}
	}
}
func TestWindowsEjectUsesPnPSafeRemovalAndEncodedIdentity(t *testing.T) {
	volume := usbVolume{Path: `E:\`, Device: "4", UUID: "identity';not executable"}
	calls := 0
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		calls++
		if name != "powershell.exe" || len(args) != 4 || args[2] != "-EncodedCommand" {
			t.Fatal(name, args)
		}
		bytes, err := base64.StdEncoding.DecodeString(args[3])
		if err != nil {
			t.Fatal(err)
		}
		units := make([]uint16, len(bytes)/2)
		for i := range units {
			units[i] = binary.LittleEndian.Uint16(bytes[i*2:])
		}
		script := string(utf16.Decode(units))
		if !strings.Contains(script, "CM_Request_Device_EjectW") || !strings.Contains(script, "$disk.IsSystem") || strings.Contains(script, volume.UUID) {
			t.Fatal("unsafe Windows eject script")
		}
		return nil, nil
	}
	if err := ejectUSBOnPlatform(context.Background(), "windows", volume, run); err != nil || calls != 1 {
		t.Fatal(err, calls)
	}
	volume.Path = "C:;unsafe"
	if err := ejectUSBOnPlatform(context.Background(), "windows", volume, run); err == nil || calls != 1 {
		t.Fatal("invalid Windows drive accepted")
	}
}
