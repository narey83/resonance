"""Caddy-owned maintenance coordinator. No Docker socket or stored credentials."""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

MESSAGE = 'The server is being maintained. We will reconnect automatically when it is ready.'
BACKEND = os.environ.get('BACKEND_URL', 'http://resonance-backend:5030').rstrip('/')


class Maintenance:
    def __init__(self, directory, clock=time.time):
        self.path = Path(directory) / 'active.json'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self.lock = threading.RLock()
        self.healthy_samples = 0

    def read(self):
        try:
            return json.loads(self.path.read_text())
        except FileNotFoundError:
            return None

    def save(self, value):
        temp = self.path.with_suffix('.tmp')
        temp.write_text(json.dumps(value))
        temp.replace(self.path)

    def enable(self):
        with self.lock:
            if self.path.exists():
                return False
            self.save({'startedAt': self.clock(), 'observedOffline': False})
            self.healthy_samples = 0
            return True

    def sample(self, healthy):
        with self.lock:
            state = self.read()
            if not state:
                return
            if not healthy:
                self.healthy_samples = 0
                if not state['observedOffline']:
                    state['observedOffline'] = True
                    self.save(state)
                return
            self.healthy_samples += 1
            elapsed = self.clock() - state['startedAt']
            # Observe the outage then require three consecutive successful probes.
            # If restart never happened, release a healthy server after one minute.
            if self.healthy_samples >= 3 and elapsed >= (10 if state['observedOffline'] else 60):
                self.path.unlink(missing_ok=True)

    def status(self):
        with self.lock:
            state = self.read()
            return {'maintenance': bool(state), 'code': 'maintenance' if state else 'available',
                    'message': MESSAGE if state else '', 'retryAfter': 5}


state = Maintenance(os.environ.get('STATE_DIR', '/state'))


def backend_ready():
    try:
        with urlopen(BACKEND + '/api/v0/session/initialized', timeout=3) as response:
            if json.load(response) is not True:
                return False
        with urlopen(BACKEND + '/api/v0/startup', timeout=3) as response:
            services = json.load(response).get('services', [])
        # Share discovery can continue in the background; core and databases must be ready.
        core = [item for item in services if item.get('id') == 'core']
        required = [item for item in services if item.get('id', '').startswith('database')]
        return bool(core) and all(item.get('state') == 'ready' for item in core + required)
    except (OSError, ValueError, URLError):
        return False


def monitor():
    while True:
        try:
            if state.path.exists():
                state.sample(backend_ready())
        except (OSError, ValueError):
            pass  # Keep maintenance enabled if readiness or state cannot be verified.
        time.sleep(2)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log request headers or credentials.

    def send_json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/maintenance/status':
            return self.send_json(200, state.status())
        self.send_json(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path != '/maintenance/control':
            return self.send_json(404, {'error': 'Not found'})
        # Explicit bearer authentication, checked by the backend's existing JWT/admin policy.
        token = self.headers.get('Authorization', '')
        if not token.startswith('Bearer '):
            return self.send_json(401, {'error': 'Administrator sign-in required'})
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc != self.headers.get('Host'):
            return self.send_json(403, {'error': 'Cross-origin control is forbidden'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 1024 or self.headers.get_content_type() != 'application/json':
                return self.send_json(400, {'error': 'Expected a small JSON request'})
            body = json.loads(self.rfile.read(length))
            if body != {'action': 'restart'}:
                return self.send_json(400, {'error': 'Unsupported action'})
            request = Request(BACKEND + '/api/v0/options/yaml/location', headers={'Authorization': token})
            with urlopen(request, timeout=5) as response:
                if response.status != 200:
                    return self.send_json(403, {'error': 'Administrator sign-in required'})
        except HTTPError as error:
            return self.send_json(error.code if error.code in (401, 403) else 503, {'error': 'Administrator verification failed'})
        except (OSError, ValueError):
            return self.send_json(503, {'error': 'Backend unavailable; restart was not requested'})
        if not state.enable():
            return self.send_json(409, {'error': 'Maintenance is already in progress'})
        request = Request(BACKEND + '/api/v0/application', data=b'{}', method='PUT',
                          headers={'Authorization': token, 'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=10):
                pass
        except HTTPError:
            # A definite rejection means restart did not happen; release only if healthy.
            state.sample(backend_ready())
            return self.send_json(502, {'error': 'Restart was rejected; maintenance will clear once health is confirmed'})
        except OSError:
            pass  # A restart can close the response socket; the independent watcher decides recovery.
        self.send_json(202, state.status())


if __name__ == '__main__':
    threading.Thread(target=monitor, daemon=True).start()
    ThreadingHTTPServer((os.environ.get('MAINTENANCE_LISTEN', '127.0.0.1'), 8090), Handler).serve_forever()
