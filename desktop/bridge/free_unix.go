//go:build darwin || linux

// SPDX-License-Identifier: AGPL-3.0-only
package main

import "syscall"

func freeBytes(path string) (uint64, error) {
	var s syscall.Statfs_t
	e := syscall.Statfs(path, &s)
	return uint64(s.Bavail) * uint64(s.Bsize), e
}
