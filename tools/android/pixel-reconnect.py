#!/usr/bin/env python3
"""Restore the paired Resonance Pixel transport; never pair or touch other devices."""
import ipaddress
import logging
import subprocess
import time

ADB = "/home/narey/Android/Sdk/platform-tools/adb"
SERIAL = "4B211FDAS002B9"
SERVICE = "_adb-tls-connect._tcp"


def run(*args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return result.stdout if result.returncode == 0 else ""


def adb(*args):
    return run(ADB, *args)


def is_pixel(name):
    return name.startswith("adb-" + SERIAL + "-")


def endpoint(address, port):
    """Accept resolved IP endpoints only, never arbitrary names from discovery."""
    try:
        ip = ipaddress.ip_address(address)
        number = int(port)
    except ValueError:
        return None
    if not 1 <= number <= 65535 or ip.is_unspecified or ip.is_multicast:
        return None
    return f"[{ip}]:{number}" if ip.version == 6 else f"{ip}:{number}"


def discover():
    targets = set()
    for line in adb("mdns", "services").splitlines():
        fields = line.split()
        if len(fields) == 3 and is_pixel(fields[0]) and fields[1] == SERVICE:
            address, _, port = fields[2].rpartition(":")
            target = endpoint(address.strip("[]"), port)
            if target:
                targets.add(target)
    # Independent resolver: ADB's discovery cache can miss a changed address.
    for line in run("avahi-browse", "-rtp", SERVICE).splitlines():
        fields = line.split(";")
        if len(fields) >= 9 and fields[0] == "=" and is_pixel(fields[3]) and fields[4] == SERVICE:
            target = endpoint(fields[7], fields[8])
            if target:
                targets.add(target)
    return targets


def reconcile():
    discovered = discover()
    connected = []
    for line in adb("devices").splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[1] == "device":
            connected.append(fields[0])
    for target in sorted(discovered - set(connected)):
        adb("connect", target)
    if discovered - set(connected):
        connected = [row[0] for line in adb("devices").splitlines()
                     if len(row := line.split()) == 2 and row[1] == "device"]
    for target in connected:
        if target not in discovered and target != SERIAL and not is_pixel(target):
            continue
        if adb("-s", target, "shell", "getprop", "ro.serialno").strip() != SERIAL:
            continue
        mappings = adb("-s", target, "reverse", "--list")
        if not any(row.split()[1:] == ["tcp:8081", "tcp:8082"] for row in mappings.splitlines()):
            adb("-s", target, "reverse", "tcp:8081", "tcp:8082")
            mappings = adb("-s", target, "reverse", "--list")
        if any(row.split()[1:] == ["tcp:8081", "tcp:8082"] for row in mappings.splitlines()):
            return "Pixel connected; Metro forwarding ready"
        return "Pixel connected but Metro forwarding failed; retrying"
    return "Pixel unavailable; waiting for wireless debugging on the same LAN"


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    previous = None
    while True:
        status = reconcile()
        if status != previous:
            logging.info(status)
            previous = status
        time.sleep(10)
