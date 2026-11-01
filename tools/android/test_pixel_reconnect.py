"""Run with python3 -m unittest discover -s tools/android."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("reconnect", Path(__file__).with_name("pixel-reconnect.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ReconnectTests(unittest.TestCase):
    def test_avahi_recovers_changed_address_and_ignores_other_devices(self):
        name = f"adb-{m.SERIAL}-abc"
        with patch.object(m, "adb", return_value=""), patch.object(m, "run", return_value=(
            f"=;eth0;IPv4;{name};{m.SERVICE};local;Pixel.local;192.168.0.91;40001;\n"
            f"=;eth0;IPv4;adb-other-abc;{m.SERVICE};local;Other.local;192.168.0.92;40002;"
        )):
            self.assertEqual(m.discover(), {"192.168.0.91:40001"})

    def test_adb_discovery_and_deduplication(self):
        with patch.object(m, "adb", return_value=f"adb-{m.SERIAL}-abc {m.SERVICE} 192.168.0.93:44444\n"), patch.object(m, "run", return_value=""):
            self.assertEqual(m.discover(), {"192.168.0.93:44444"})

    def test_invalid_endpoints(self):
        for address, port in [("example.com", "123"), ("192.168.0.1", "0"), ("192.168.0.1", "65536"), ("0.0.0.0", "123")]:
            self.assertIsNone(m.endpoint(address, port))
        self.assertEqual(m.endpoint("::1", "123"), "[::1]:123")

    def test_timeout_does_not_abort_other_discovery(self):
        with patch.object(m.subprocess, "run", side_effect=subprocess.TimeoutExpired("adb", 15)):
            self.assertEqual(m.run("adb"), "")

    def test_reconnect_and_restore_forwarding(self):
        target = "192.168.0.99:45678"
        calls = []
        def adb(*args):
            calls.append(args)
            if args == ("devices",):
                return f"{target}\tdevice\n" if ("connect", target) in calls else ""
            if "getprop" in args:
                return m.SERIAL
            if args[-2:] == ("reverse", "--list") and ("-s", target, "reverse", "tcp:8081", "tcp:8082") in calls:
                return "device tcp:8081 tcp:8082\n"
            return ""
        with patch.object(m, "discover", return_value={target}), patch.object(m, "adb", side_effect=adb):
            self.assertIn("ready", m.reconcile())
        self.assertIn(("connect", target), calls)
        self.assertIn(("-s", target, "reverse", "tcp:8081", "tcp:8082"), calls)

    def test_wrong_serial_never_forwarded(self):
        target = "192.168.0.99:45678"
        with patch.object(m, "discover", return_value={target}), patch.object(m, "adb", side_effect=lambda *a: f"{target} device" if a == ("devices",) else "wrong") as adb:
            self.assertIn("unavailable", m.reconcile())
        self.assertFalse(any("reverse" in c.args for c in adb.call_args_list))

    def test_unrelated_devices_not_probed(self):
        with patch.object(m, "discover", return_value=set()), patch.object(m, "adb", return_value="unrelated device\n") as adb:
            self.assertIn("unavailable", m.reconcile())
        adb.assert_called_once_with("devices")
