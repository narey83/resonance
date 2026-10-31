#!/usr/bin/env python3
"""Restore the paired Resonance Pixel transport; never pair or touch other devices."""
import logging
import subprocess
import time

ADB = "/home/narey/Android/Sdk/platform-tools/adb"
SERIAL = "4B211FDAS002B9"


def adb(*args):
    result = subprocess.run([ADB, *args], capture_output=True, text=True, timeout=15)
    return result.stdout if result.returncode == 0 else ""


def reconcile():
    for line in adb("mdns", "services").splitlines():
        fields = line.split()
        if len(fields) == 3 and fields[0].startswith("adb-" + SERIAL + "-") and fields[1] == "_adb-tls-connect._tcp":
            adb("connect", fields[2])
    for line in adb("devices").splitlines():
        fields = line.split()
        if len(fields) != 2 or fields[1] != "device":
            continue
        target = fields[0]
        if adb("-s", target, "shell", "getprop", "ro.serialno").strip() != SERIAL:
            continue
        mappings = adb("-s", target, "reverse", "--list")
        if not any(row.split()[1:] == ["tcp:8081", "tcp:8082"] for row in mappings.splitlines()):
            adb("-s", target, "reverse", "tcp:8081", "tcp:8082")
            if "tcp:8081 tcp:8082" in adb("-s", target, "reverse", "--list"):
                logging.info("Restored Pixel Metro connection")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    while True:
        try:
            reconcile()
        except (OSError, subprocess.TimeoutExpired):
            logging.warning("ADB unavailable; retrying")
        time.sleep(10)
