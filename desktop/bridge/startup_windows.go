// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"golang.org/x/sys/windows/registry"
	"syscall"
)

func configureWindowsStartup(executable string, enabled bool) error {
	key, _, e := registry.CreateKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if e != nil {
		return e
	}
	defer key.Close()
	if !enabled {
		e = key.DeleteValue("ResonanceHelper")
		if e == registry.ErrNotExist {
			return nil
		}
		return e
	}
	return key.SetStringValue("ResonanceHelper", syscall.EscapeArg(executable)+" --no-open")
}
func windowsStartupEntry(string) (string, []byte, error) { return "", nil, nil }
