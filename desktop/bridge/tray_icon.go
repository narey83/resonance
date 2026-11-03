//go:build windows || linux

// SPDX-License-Identifier: AGPL-3.0-only
package main

import _ "embed"

//go:embed assets/favicon.ico
var trayICO []byte

//go:embed assets/tray.png
var trayPNG []byte
