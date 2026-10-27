"""Linux regression checks for development-container stop forwarding."""
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest

WRAPPER = Path(__file__).with_name("backend-watch.sh")


class WatchStopTests(unittest.TestCase):
    def test_app_cleanup_finishes_before_watcher_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "app.py"
            app.write_text(r"""import ctypes, signal, time
from pathlib import Path
ctypes.CDLL(None).prctl(15, b'resonance', 0, 0, 0)
p = Path(__file__).with_name('events')
def stop(*_):
    p.write_text(p.read_text() + 'cleanup-start\n')
    time.sleep(0.3)
    p.write_text(p.read_text() + 'cleanup-done\n')
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
p.write_text('ready\n')
while True: time.sleep(0.05)
""")
            watcher = root / "watch.py"
            watcher.write_text("""import signal, subprocess, sys
signal.signal(signal.SIGTERM, signal.SIG_IGN)
child = subprocess.Popen([sys.executable, sys.argv[1]])
raise SystemExit(child.wait())
""")
            process = subprocess.Popen(["sh", str(WRAPPER), "python3", str(watcher), str(app)], start_new_session=True)
            try:
                deadline = time.monotonic() + 5
                while not (root / "events").exists():
                    if time.monotonic() > deadline: self.fail("fixture did not start")
                    time.sleep(0.02)
                process.send_signal(signal.SIGTERM)
                self.assertEqual(process.wait(timeout=8), 0)
                self.assertEqual((root / "events").read_text(), "ready\ncleanup-start\ncleanup-done\n")
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()

    def test_stop_without_running_application(self):
        process = subprocess.Popen(["sh", str(WRAPPER), "sleep", "100"], start_new_session=True)
        try:
            time.sleep(0.1)
            process.send_signal(signal.SIGTERM)
            self.assertEqual(process.wait(timeout=8), 0)
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


if __name__ == "__main__":
    unittest.main()
