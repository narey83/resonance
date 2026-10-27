//go:build !windows

// SPDX-License-Identifier: AGPL-3.0-only
package main

import "os"

func replaceSettings(from, to string) error { return os.Rename(from, to) }
