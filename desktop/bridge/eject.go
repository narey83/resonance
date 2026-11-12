// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"unicode/utf16"
)

// Keep discovery and ejection together so requests only address current OS identities.
type usbDeviceManager interface {
	List() ([]usbVolume, error)
	Eject(context.Context, usbVolume) error
}
type systemUSBDevices struct{}

func (systemUSBDevices) List() ([]usbVolume, error) { return usbVolumes() }
func (systemUSBDevices) Eject(ctx context.Context, volume usbVolume) error {
	return ejectUSBOnPlatform(ctx, runtime.GOOS, volume, func(ctx context.Context, name string, args ...string) ([]byte, error) {
		return exec.CommandContext(ctx, name, args...).CombinedOutput()
	})
}
func (h *helper) usbDeviceManager() usbDeviceManager {
	if h.usbDevices != nil {
		return h.usbDevices
	}
	return systemUSBDevices{}
}
func (h *helper) findUSBVolume(id string) (usbVolume, error) {
	volumes, err := h.usbDeviceManager().List()
	if err != nil {
		return usbVolume{}, err
	}
	for _, volume := range volumes {
		if volume.ID == id {
			return volume, nil
		}
	}
	return usbVolume{}, errors.New("selected USB drive is no longer mounted or has changed")
}
func onUSBVolume(volume, path string) bool {
	if path == "" {
		return false
	}
	relative, err := filepath.Rel(volume, path)
	return err == nil && !filepath.IsAbs(relative) && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
func (h *helper) ejectUSB(ctx context.Context, id string) (usbVolume, error) {
	if !h.operation.TryLock() {
		return usbVolume{}, errors.New("another Bridge operation is in progress")
	}
	defer h.operation.Unlock()
	h.mu.Lock()
	if h.Updating || (h.USB != nil && (h.USB.Status == "writing" || h.USB.Status == "downloading")) {
		h.mu.Unlock()
		return usbVolume{}, errors.New("finish or cancel the current USB transfer before ejecting")
	}
	h.mu.Unlock()
	volume, err := h.findUSBVolume(id)
	if err != nil {
		return usbVolume{}, err
	}
	h.mu.Lock()
	inUse := onUSBVolume(volume.Path, h.Cache)
	if h.Session != nil && h.Session.DB != nil {
		inUse = inUse || onUSBVolume(volume.Path, h.Session.DB.ExportRoot)
	}
	if h.Library != nil {
		inUse = inUse || onUSBVolume(volume.Path, h.Library.Root)
	}
	h.mu.Unlock()
	if inUse {
		return usbVolume{}, errors.New("Bridge is using files on this drive; use the operating system to eject it after closing Bridge")
	}
	if err = h.usbDeviceManager().Eject(ctx, volume); err != nil {
		return usbVolume{}, err
	}
	// Success means the OS accepted safe removal; never force an unmount on failure.
	h.mu.Lock()
	if h.USB != nil && h.USB.DestinationID == volume.ID && h.USB.Status == "completed" {
		h.USB.Status = "ejected"
	}
	h.mu.Unlock()
	h.Diagnostics.event("info", "usb.ejected", map[string]any{"label": volume.Label})
	return volume, nil
}

type deviceCommand func(context.Context, string, ...string) ([]byte, error)

func ejectUSBOnPlatform(ctx context.Context, platform string, volume usbVolume, run deviceCommand) error {
	switch platform {
	case "darwin":
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
			return errors.New("could not identify the USB disk")
		}
		data, err = run(ctx, "/usr/sbin/diskutil", "info", "-plist", "/dev/"+disk)
		if err != nil {
			return errors.New("could not recheck the USB disk")
		}
		whole := plistValues(data)
		if whole["Internal"] != "false" || whole["BusProtocol"] != "USB" || whole["WholeDisk"] != "true" || whole["DeviceIdentifier"] != disk {
			return errors.New("the selected device is not an external USB disk")
		}
		return runSafeEject(ctx, run, "/usr/sbin/diskutil", "eject", "/dev/"+disk)
	case "linux":
		data, err := run(ctx, "lsblk", "--json", "--output", "PATH,TYPE,TRAN,UUID,MOUNTPOINTS")
		if err != nil {
			return errors.New("could not recheck USB disk mounts")
		}
		disk, err := linuxEjectDisk(data, volume)
		if err != nil {
			return err
		}
		if err = runSafeEject(ctx, run, "udisksctl", "unmount", "--block-device", volume.Device, "--no-user-interaction"); err != nil {
			return err
		}
		if err = runSafeEject(ctx, run, "udisksctl", "power-off", "--block-device", disk, "--no-user-interaction"); err != nil {
			return fmt.Errorf("USB volume was unmounted but safe removal did not complete: %w", err)
		}
		return nil
	case "windows":
		if !validWindowsUSBPath(volume.Path) || !regexp.MustCompile(`^[0-9]+$`).MatchString(volume.Device) {
			return errors.New("invalid USB volume identity")
		}
		input, _ := json.Marshal(map[string]string{"path": volume.Path, "device": volume.Device, "uuid": volume.UUID})
		script := strings.Replace(windowsEjectScript, "VOLUME_JSON", base64.StdEncoding.EncodeToString(input), 1)
		chars := utf16.Encode([]rune(script))
		encoded := make([]byte, len(chars)*2)
		for i, c := range chars {
			binary.LittleEndian.PutUint16(encoded[i*2:], c)
		}
		return runSafeEject(ctx, run, "powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.StdEncoding.EncodeToString(encoded))
	default:
		return fmt.Errorf("safe USB eject is unavailable on %s", platform)
	}
}
func validWindowsUSBPath(path string) bool {
	if len(path) != 3 {
		return false
	}
	letter := path[0]
	return ((letter >= 'A' && letter <= 'Z') || (letter >= 'a' && letter <= 'z')) && path[1] == ':' && path[2] == '\\'
}

func runSafeEject(ctx context.Context, run deviceCommand, name string, args ...string) error {
	output, err := run(ctx, name, args...)
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return errors.New("USB eject timed out; check the drive in your operating system before unplugging it")
	}
	detail := strings.TrimSpace(string(output))
	if len(detail) > 500 {
		detail = detail[:500]
	}
	if detail == "" {
		return errors.New("the operating system could not safely eject this drive; close files or apps using it and try again")
	}
	return fmt.Errorf("could not safely eject this drive; close files or apps using it and try again: %s", detail)
}

type ejectBlock struct {
	Path      string       `json:"path"`
	Type      string       `json:"type"`
	Transport string       `json:"tran"`
	UUID      string       `json:"uuid"`
	Mounts    []*string    `json:"mountpoints"`
	Children  []ejectBlock `json:"children"`
}

func linuxEjectDisk(data []byte, volume usbVolume) (string, error) {
	var listing struct {
		Devices []ejectBlock `json:"blockdevices"`
	}
	if json.Unmarshal(data, &listing) != nil {
		return "", errors.New("could not read USB disk mounts")
	}
	for _, disk := range listing.Devices {
		if disk.Type != "disk" || disk.Transport != "usb" {
			continue
		}
		found, otherMounted, system := false, false, false
		var walk func(ejectBlock)
		walk = func(block ejectBlock) {
			matches := block.Path == volume.Device && block.UUID == volume.UUID
			for _, mount := range block.Mounts {
				if mount == nil || *mount == "" {
					continue
				}
				path := filepath.Clean(*mount)
				if path == "/" || path == "/boot" || strings.HasPrefix(path, "/boot/") || path == "/home" {
					system = true
				}
				if matches && path == volume.Path {
					found = true
				} else {
					otherMounted = true
				}
			}
			for _, child := range block.Children {
				walk(child)
			}
		}
		walk(disk)
		if found {
			if system {
				return "", errors.New("system disks cannot be ejected")
			}
			if otherMounted {
				return "", errors.New("this USB disk has other mounted volumes; eject the whole disk through your operating system")
			}
			if !strings.HasPrefix(disk.Path, "/dev/") {
				return "", errors.New("invalid USB disk path")
			}
			return disk.Path, nil
		}
	}
	return "", errors.New("USB drive identity changed; refresh the drive list")
}

// Windows PnP safe-removal requests are vetoed when another application is using the device.
const windowsEjectScript = `$ErrorActionPreference='Stop'
$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('VOLUME_JSON')) | ConvertFrom-Json
$volume=Get-Volume -DriveLetter $v.path.Substring(0,1) -ErrorAction Stop
$partition=Get-Partition -DriveLetter $volume.DriveLetter -ErrorAction Stop
$disk=Get-Disk -Number $partition.DiskNumber -ErrorAction Stop
if($volume.UniqueId -ne $v.uuid -or [string]$disk.Number -ne $v.device -or $disk.BusType -ne 'USB' -or $disk.IsBoot -or $disk.IsSystem){throw 'USB drive identity changed or system disk selected'}
$device=Get-CimInstance Win32_DiskDrive -Filter ('Index='+[int]$disk.Number)
if(!$device.PNPDeviceID){throw 'Could not identify USB device'}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ResonanceSafeEject {
 [DllImport("cfgmgr32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] public static extern uint CM_Locate_DevNodeW(out uint node,string id,uint flags);
 [DllImport("cfgmgr32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] public static extern uint CM_Request_Device_EjectW(uint node,out uint veto,StringBuilder name,uint length,uint flags);
}
'@
[uint32]$node=0
if([ResonanceSafeEject]::CM_Locate_DevNodeW([ref]$node,$device.PNPDeviceID,0) -ne 0){throw 'Could not locate USB device'}
[uint32]$veto=0
$name=New-Object Text.StringBuilder 260
$result=[ResonanceSafeEject]::CM_Request_Device_EjectW($node,[ref]$veto,$name,260,0)
if($result -ne 0){throw ('Windows could not safely remove the USB device (veto '+$veto+'). Close files or apps using it and retry.')}
`
