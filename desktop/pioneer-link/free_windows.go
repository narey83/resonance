//go:build windows

// SPDX-License-Identifier: AGPL-3.0-only
package main

import "golang.org/x/sys/windows"

func freeBytes(path string) (uint64, error) {
	p, e := windows.UTF16PtrFromString(path)
	if e != nil {
		return 0, e
	}
	var free, total, totalFree uint64
	e = windows.GetDiskFreeSpaceEx(p, &free, &total, &totalFree)
	return free, e
}
