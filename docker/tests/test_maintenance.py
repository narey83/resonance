import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('maintenance', Path(__file__).parents[1] / 'maintenance' / 'maintenance.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.now = 100
        self.state = module.Maintenance(self.directory.name, lambda: self.now)

    def tearDown(self):
        self.directory.cleanup()

    def test_waits_for_outage_and_stable_recovery(self):
        self.assertTrue(self.state.enable())
        self.assertFalse(self.state.enable())
        self.now += 12
        self.state.sample(False)
        self.state.sample(True)
        self.state.sample(False)
        for _ in range(2):
            self.state.sample(True)
        self.assertTrue(self.state.status()['maintenance'])
        self.state.sample(True)
        self.assertFalse(self.state.status()['maintenance'])

    def test_rejected_or_missed_restart_releases_only_healthy_server(self):
        self.state.enable()
        self.now += 59
        for _ in range(4):
            self.state.sample(True)
        self.assertTrue(self.state.status()['maintenance'])
        self.now += 2
        self.state.sample(True)
        self.assertFalse(self.state.status()['maintenance'])

    def test_state_survives_watcher_restart_and_never_times_out_offline(self):
        self.state.enable()
        resumed = module.Maintenance(self.directory.name, lambda: self.now)
        self.now += 3600
        resumed.sample(False)
        self.assertTrue(resumed.status()['maintenance'])
        self.assertTrue(resumed.read()['observedOffline'])


if __name__ == '__main__':
    unittest.main()

class ControlTests(unittest.TestCase):
    def test_authentication_restart_and_public_status(self):
        import json
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        calls = []

        class Backend(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                allowed = self.headers.get('Authorization') == 'Bearer admin'
                self.send_response(200 if allowed else 403)
                self.end_headers()
                self.wfile.write(b'"Database (settings table)"')

            def do_PUT(self):
                calls.append(self.path)
                self.send_response(204)
                self.end_headers()

        backend = ThreadingHTTPServer(('127.0.0.1', 0), Backend)
        coordinator = ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
        original_backend, original_state = module.BACKEND, module.state
        with tempfile.TemporaryDirectory() as directory:
            module.BACKEND = 'http://127.0.0.1:' + str(backend.server_port)
            module.state = module.Maintenance(directory)
            for server in [backend, coordinator]:
                threading.Thread(target=server.serve_forever, daemon=True).start()
            url = 'http://127.0.0.1:' + str(coordinator.server_port)
            try:
                for token, origin, expected in [('', None, 401), ('Bearer user', None, 403), ('Bearer admin', 'https://other.invalid', 403), ('Bearer admin', None, 202)]:
                    headers = {'Content-Type': 'application/json', 'Authorization': token}
                    if origin:
                        headers['Origin'] = origin
                    request = Request(url + '/maintenance/control', data=b'{"action":"restart"}', headers=headers)
                    try:
                        with urlopen(request) as response:
                            self.assertEqual(response.status, expected)
                    except HTTPError as error:
                        self.assertEqual(error.code, expected)
                self.assertEqual(calls, ['/api/v0/application'])
                with urlopen(url + '/maintenance/status') as response:
                    self.assertTrue(json.load(response)['maintenance'])
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertNotIn('admin', module.state.path.read_text())
            finally:
                for server in [backend, coordinator]:
                    server.shutdown()
                    server.server_close()
                module.BACKEND, module.state = original_backend, original_state
