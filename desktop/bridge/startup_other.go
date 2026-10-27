//go:build !windows

// SPDX-License-Identifier: AGPL-3.0-only
package main

import "errors"

func windowsStartupEntry(string) (string, []byte, error) {
	return "", nil, errors.New("Windows startup is unavailable")
}

func configureWindowsStartup(string, bool) error { return errors.New("Windows startup is unavailable") }
