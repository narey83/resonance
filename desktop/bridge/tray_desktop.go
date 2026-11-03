//go:build windows || linux

// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"fyne.io/systray"
	"log"
	"os"
	"runtime"
	"time"
)

func trayImage() []byte {
	if runtime.GOOS == "windows" {
		return trayICO
	}
	return trayPNG
}
func runDesktop(ctx context.Context, h *helper, address string) {
	if runtime.GOOS == "linux" && os.Getenv("DBUS_SESSION_BUS_ADDRESS") == "" {
		log.Print("No desktop D-Bus session; helper dashboard remains available")
		<-ctx.Done()
		return
	}
	systray.Run(func() {
		systray.SetIcon(trayImage())
		systray.SetTooltip("Resonance Bridge")
		status := systray.AddMenuItem("Resonance Bridge "+helperVersion, "")
		status.Disable()
		open := systray.AddMenuItem("Open dashboard", "")
		usb := systray.AddMenuItem("USB export", "")
		eject := systray.AddMenuItem("Safely eject USB…", "Choose a USB drive for safe removal")
		settings := systray.AddMenuItem("Bridge settings", "")
		update := systray.AddMenuItem("Checking update status…", "")
		update.Disable()
		check := systray.AddMenuItem("Check for updates", "")
		startup := systray.AddMenuItemCheckbox("Start at sign-in", "", startupEnabled(h.Cache))
		systray.AddSeparator()
		quit := systray.AddMenuItem("Quit Resonance Bridge", "")
		go func() {
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					systray.Quit()
					return
				case <-open.ClickedCh:
					openDashboard("http://" + address + "/")
				case <-usb.ClickedCh:
					openDashboard("http://" + address + "/usb")
				case <-eject.ClickedCh:
					openDashboard("http://" + address + "/usb#eject")
				case <-settings.ClickedCh:
					openDashboard("http://" + address + "/settings")
				case <-check.ClickedCh:
					h.Updates.check()
				case <-startup.ClickedCh:
					enabled := !startupEnabled(h.Cache)
					if e := configureStartup(h.Cache, enabled); e != nil {
						log.Print(e)
						update.SetTitle("Startup setting failed: " + e.Error())
					} else if enabled {
						startup.Check()
					} else {
						startup.Uncheck()
					}
				case <-quit.ClickedCh:
					h.Shutdown()
				case <-ticker.C:
					h.mu.Lock()
					running := h.Session != nil
					busy := h.busyForUpdate()
					h.mu.Unlock()
					title := "Resonance Bridge · idle"
					if running {
						title = "Resonance Bridge · Network Link active"
					} else if busy {
						title = "Resonance Bridge · busy"
					}
					status.SetTitle(title)
					view := h.Updates.snapshot()
					title = view.Status
					if view.Error != "" {
						title += " · " + view.Error
					}
					update.SetTitle(title)
				}
			}
		}()
	}, func() { h.Shutdown() })
}
