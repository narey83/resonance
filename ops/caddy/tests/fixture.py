"""Real Caddy with a local upstream; also reusable for browser verification."""

import json
import base64
import hashlib
import os
import pathlib
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[3]


class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.reply()

    def do_POST(self):
        self.reply()

    def reply(self):
        fixture = self.server.fixture
        if self.path.split('?')[0] == '/health/ready':
            fixture.last_probe = {'path': self.path, 'authorization': self.headers.get('Authorization'), 'cookie': self.headers.get('Cookie'), 'apiKey': self.headers.get('X-Api-Key'), 'linkToken': self.headers.get('X-Resonance-Link-Token'), 'upgrade': self.headers.get('Upgrade')}
            mode = json.loads(fixture.mode.read_text())
            if mode['state'] == 'offline':
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            self.send_response(mode['status'])
            if mode.get('header', True):
                self.send_header('X-Resonance-Site-State', mode['state'])
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'state': mode['state']}).encode())
            return
        if self.path == '/api/v0/session/initialized':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'true')
            return
        if self.path.startswith('/hub/'):
            if self.headers.get('Upgrade', '').lower() == 'websocket':
                fixture.last_websocket_path = self.path
                self.protocol_version = 'HTTP/1.1'
                key = self.headers.get('Sec-WebSocket-Key', '')
                accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
                self.send_response(101)
                self.send_header('Upgrade', 'websocket')
                self.send_header('Connection', 'Upgrade')
                self.send_header('Sec-WebSocket-Accept', accept)
                self.end_headers()
                frame = self.rfile.read(2)
                if len(frame) != 2:
                    return
                length = frame[1] & 127
                mask = self.rfile.read(4)
                payload = self.rfile.read(length)
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
                self.wfile.write(bytes([0x81, len(payload)]) + payload)
                self.wfile.flush()
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            self.wfile.write(b'data: connected\n\n')
            return
        if self.path.startswith('/api/reset'):
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        status = 503 if self.path.startswith('/api/business503') else 401 if self.path.startswith('/api/private') else 200
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'method': self.command, 'path': self.path, 'body': body.decode(), 'authorization': self.headers.get('Authorization'), 'cookie': self.headers.get('Cookie'), 'apiKey': self.headers.get('X-Api-Key'), 'linkToken': self.headers.get('X-Resonance-Link-Token')}).encode())


class SiteFixture:
    def __init__(self, caddy, web_root=None):
        self.temporary = tempfile.TemporaryDirectory(prefix='resonance-caddy-test-')
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.web = pathlib.Path(web_root) if web_root else self.root / 'web'
        if not web_root:
            self.web.mkdir()
            (self.web / 'index.html').write_text('<!doctype html><title>App ready</title><h1>APP_READY</h1>')
        self.mode = self.root / 'upstream.json'
        self.set_mode('available')
        self.last_probe = None
        self.backend = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        self.backend.fixture = self
        self.thread = threading.Thread(target=self.backend.serve_forever, daemon=True)
        self.thread.start()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            self.port = listener.getsockname()[1]
        self.origin = f'http://127.0.0.1:{self.port}'
        self.config = self.root / 'Caddyfile'
        self.config.write_text('{\n admin off\n auto_https off\n}\nimport "' + str(ROOT / 'ops/caddy/site.caddy') + '"\n' + self.origin + ' {\n import resonance_site\n}\n')
        environment = dict(os.environ, RESONANCE_STATUS_ROOT=str(ROOT / 'ops/caddy/status'), RESONANCE_WEB_ROOT=str(self.web), RESONANCE_SITE_STATE_ROOT=str(self.state), RESONANCE_BACKEND_UPSTREAM=f'127.0.0.1:{self.backend.server_port}')
        self.log = (self.root / 'caddy.log').open('wb')
        self.process = subprocess.Popen([str(caddy), 'run', '--config', str(self.config), '--adapter', 'caddyfile'], env=environment, stdout=self.log, stderr=self.log)
        for _ in range(100):
            if self.process.poll() is not None:
                message = (self.root / 'caddy.log').read_text()
                self.close()
                raise RuntimeError(message)
            try:
                if self.request('/__site/live')[0] == 200:
                    break
            except OSError:
                pass
            time.sleep(.1)
        else:
            self.close()
            raise RuntimeError('Caddy did not start')

    def set_mode(self, state, status=None, header=True):
        status = status if status is not None else 200 if state in ('available', 'degraded') else 503
        temporary = self.mode.with_suffix('.tmp')
        temporary.write_text(json.dumps({'state': state, 'status': status, 'header': header}))
        temporary.replace(self.mode)

    def request(self, path, method='GET', body=None, headers=None):
        request = urllib.request.Request(self.origin + path, method=method, data=body, headers=headers or {})
        try:
            response = urllib.request.urlopen(request, timeout=8)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, dict(response.headers), response.read()

    def close(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.backend.shutdown()
        self.backend.server_close()
        self.log.close()
        self.temporary.cleanup()
