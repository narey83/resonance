"""Supervise a private helper alongside the container's primary service.

The primary service owns container lifetime. Helpers restart with bounded backoff;
container shutdown drains the primary service before terminating its helper.
"""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path


def commands(mode):
    if mode == 'caddy':
        return [sys.executable, '/opt/resonance/maintenance.py'], None
    root = os.environ.get('RESONANCE_BGUTIL_ROOT')
    if not root:
        return None, None  # Native development may supply its own provider.
    entry = Path(root) / 'build/main.js'
    node = Path(root) / 'node'
    if not entry.is_file() or not node.is_file():
        raise RuntimeError('Bundled YouTube token provider is missing')
    return [str(node), str(entry), '--host', '127.0.0.1'], root


def run(main_command, helper_command, helper_directory=None):
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    helper = main = None
    retry_at = 0
    delay = 1
    started = 0
    try:
        if helper_command:
            helper = subprocess.Popen(helper_command, cwd=helper_directory, start_new_session=True)
            started = time.monotonic()
        main = subprocess.Popen(main_command, start_new_session=True)
        while main.poll() is None and not stopping:
            now = time.monotonic()
            if helper_command and helper is not None and helper.poll() is not None:
                if now - started > 60:
                    delay = 1
                retry_at = now + delay
                delay = min(delay * 2, 30)
                helper = None
                print('Resonance helper exited; restarting with backoff', flush=True)
            if helper_command and helper is None and now >= retry_at:
                helper = subprocess.Popen(helper_command, cwd=helper_directory, start_new_session=True)
                started = now
            time.sleep(0.2)
        return main.returncode if main.returncode is not None else 0
    finally:
        # Let backend-watch forward TERM to the application and drain its writes.
        if main is not None and main.poll() is None:
            main.terminate()
            try:
                main.wait(timeout=120)
            except subprocess.TimeoutExpired:
                os.killpg(main.pid, signal.SIGKILL)
                main.wait()
        if helper is not None and helper.poll() is None:
            os.killpg(helper.pid, signal.SIGTERM)
            try:
                helper.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(helper.pid, signal.SIGKILL)
                helper.wait()


if __name__ == '__main__':
    mode, *main = sys.argv[1:]
    if not main:
        raise SystemExit('Expected mode and primary command')
    helper, directory = commands(mode)
    raise SystemExit(run(main, helper, directory))
