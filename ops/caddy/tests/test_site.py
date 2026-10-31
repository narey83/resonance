import importlib.machinery
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import socket
import unittest
import urllib.request

from fixture import ROOT, SiteFixture


class CaddySiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.caddy = os.environ.get('CADDY_BIN') or shutil.which('caddy')
        if not cls.caddy:
            raise unittest.SkipTest('Set CADDY_BIN to run real Caddy integration tests')
        loader = importlib.machinery.SourceFileLoader('site_state', str(ROOT / 'bin/site-state'))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        cls.control = importlib.util.module_from_spec(spec)
        loader.exec_module(cls.control)
        cls.fixture = SiteFixture(pathlib.Path(cls.caddy).resolve())

    @classmethod
    def tearDownClass(cls):
        cls.fixture.close()

    def setUp(self):
        self.fixture.set_mode('available')
        self.fixture.frontend_mode = 'ready'
        self.control.set_state(self.fixture.state, 'normal')

    def assert_unavailable(self, state):
        for path in ['/library?keep=this', '/__site/status', '/api/test', '/hub/application/negotiate']:
            status, headers, body = self.fixture.request(path)
            self.assertEqual(503, status, (path, headers, body))
            self.assertEqual(state, headers['X-Resonance-Site-State'])
            self.assertEqual('caddy', headers['X-Resonance-Gateway'])
            self.assertEqual('no-store', headers['Cache-Control'])
            self.assertEqual('5', headers['Retry-After'])
            if path.startswith('/library'):
                self.assertIn(b'<!doctype html>', body)
                self.assertIn(b'recovery.js', body)
                self.assertNotIn(b'APP_READY', body)
            else:
                self.assertEqual(state, json.loads(body)['state'])
        self.assertEqual(200, self.fixture.request('/__site/live')[0])
        self.assertEqual(200, self.fixture.request('/__site/assets/recovery.js')[0])

    def test_ready_pages_status_and_streams(self):
        self.assertIn(b'APP_READY', self.fixture.request('/library')[2])
        status, headers, body = self.fixture.request('/__site/status')
        self.assertEqual(200, status)
        self.assertEqual('available', json.loads(body)['state'])
        self.assertEqual('available', headers['X-Resonance-Site-State'])
        self.assertIn(b'data: connected', self.fixture.request('/hub/stream')[2])

    def test_plain_http_does_not_advertise_quic_and_preserves_media_ranges(self):
        for path in ['/library', '/api/test-audio?track=unplayed']:
            self.assertNotIn('Alt-Svc', self.fixture.request(path)[1])
        status, headers, body = self.fixture.request('/api/test-audio', headers={'Range': 'bytes=100-199'})
        self.assertEqual(206, status)
        self.assertEqual(f'bytes 100-199/{len(self.fixture.audio)}', headers['Content-Range'])
        self.assertEqual(self.fixture.audio[100:200], body)

    def test_maintenance_precedes_restart_and_clears_without_reload(self):
        self.control.set_state(self.fixture.state, 'maintenance')
        (self.fixture.state / 'restarting').write_text('restarting')
        self.fixture.set_mode('offline')
        self.assert_unavailable('maintenance')
        self.fixture.set_mode('available')
        self.assert_unavailable('maintenance')
        self.control.set_state(self.fixture.state, 'restarting')
        self.assert_unavailable('restarting')
        self.control.set_state(self.fixture.state, 'normal')
        self.assertEqual(200, self.fixture.request('/library')[0])

    def test_status_documents_cannot_become_cached_304_or_partial_206(self):
        self.control.set_state(self.fixture.state, 'maintenance')
        status, headers, _ = self.fixture.request('/library')
        self.assertEqual(503, status)
        for conditional in [{'If-None-Match': headers.get('Etag', '*')}, {'Range': 'bytes=0-4'}, {'If-Modified-Since': 'Fri, 01 Jan 2100 00:00:00 GMT'}]:
            status, _, body = self.fixture.request('/library', headers=conditional)
            self.assertEqual(503, status)
            self.assertIn(b'<!doctype html>', body)
        self.assertEqual(503, self.fixture.request('/library', method='HEAD')[0])

    def test_transport_failure_after_successful_probe_is_unavailable(self):
        status, headers, body = self.fixture.request('/api/reset')
        self.assertEqual(503, status)
        self.assertEqual('unavailable', headers['X-Resonance-Site-State'])
        self.assertEqual('unavailable', json.loads(body)['state'])

    def test_core_startup_and_recovery(self):
        self.fixture.set_mode('starting')
        self.assert_unavailable('starting')
        self.fixture.set_mode('available')
        self.assertIn(b'APP_READY', self.fixture.request('/library')[2])

    def test_restart_waits_for_caddy_before_opening_the_site(self):
        self.control.set_state(self.fixture.state, 'restarting')
        self.assertEqual(503, self.fixture.request('/__site/status')[0])
        self.assertEqual(200, self.fixture.request('/__site/readiness')[0])
        result = subprocess.run(['python3', str(ROOT / 'bin/site-state'), 'normal', '--state-dir', str(self.fixture.state), '--wait-for', self.fixture.origin + '/__site/readiness', '--timeout', '2'], capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(200, self.fixture.request('/__site/status')[0])

    def test_failed_restart_wait_keeps_override_in_place(self):
        self.control.set_state(self.fixture.state, 'restarting')
        self.fixture.set_mode('starting')
        result = subprocess.run(['python3', str(ROOT / 'bin/site-state'), 'normal', '--state-dir', str(self.fixture.state), '--wait-for', self.fixture.origin + '/__site/readiness', '--timeout', '1'], capture_output=True, text=True)
        self.assertEqual(1, result.returncode)
        self.assertTrue((self.fixture.state / 'restarting').exists())
        self.assertEqual('restarting', self.fixture.request('/__site/status')[1]['X-Resonance-Site-State'])

    def test_restart_completion_cannot_clear_new_operator_maintenance(self):
        self.control.set_state(self.fixture.state, 'restarting')
        expected = self.control.read_override(self.fixture.state)
        self.control.set_state(self.fixture.state, 'maintenance')
        with self.assertRaises(RuntimeError):
            self.control.set_state(self.fixture.state, 'normal', expected=expected)
        self.assertEqual('maintenance', self.fixture.request('/__site/status')[1]['X-Resonance-Site-State'])

    def test_process_shutdown(self):
        self.fixture.set_mode('restarting')
        self.assert_unavailable('restarting')

    def test_unexpected_outage_is_not_called_maintenance(self):
        self.fixture.set_mode('offline')
        self.assert_unavailable('unavailable')
        self.assertNotIn('X-Resonance-Maintenance', self.fixture.request('/api/test')[1])

    def test_bad_or_missing_readiness_contract_fails_closed(self):
        for mode in [('available', 200, False), ('available', 500, True), ('unknown', 200, True)]:
            self.fixture.set_mode(*mode)
            self.assert_unavailable('unavailable')

    def test_optional_failure_keeps_site_usable(self):
        self.fixture.set_mode('degraded')
        self.assertEqual(200, self.fixture.request('/library')[0])
        self.assertEqual('degraded', json.loads(self.fixture.request('/__site/status')[2])['state'])

    def test_original_post_body_auth_and_query_survive_the_readiness_probe(self):
        original = b'{"name":"unchanged"}'
        status, _, body = self.fixture.request('/api/echo?signature=fixture', 'POST', original, {'Authorization': 'Bearer fixture', 'Cookie': 'session=fixture', 'X-Api-Key': 'fixture-api-key', 'X-Resonance-Link-Token': 'fixture-link-token'})
        self.assertEqual(200, status)
        self.assertEqual({'method': 'POST', 'path': '/api/echo?signature=fixture', 'body': original.decode(), 'authorization': 'Bearer fixture', 'cookie': 'session=fixture', 'apiKey': 'fixture-api-key', 'linkToken': 'fixture-link-token'}, json.loads(body))
        self.assertEqual({'path': '/health/ready', 'authorization': None, 'cookie': None, 'apiKey': None, 'linkToken': None, 'upgrade': None}, self.fixture.last_probe)

    def test_websocket_upgrade_and_bidirectional_payload_survive_precheck(self):
        with socket.create_connection(('127.0.0.1', self.fixture.port), timeout=8) as connection:
            connection.sendall((f'GET /hub/socket?access_token=fixture HTTP/1.1\r\nHost: 127.0.0.1:{self.fixture.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
            headers = b''
            while b'\r\n\r\n' not in headers:
                chunk = connection.recv(4096)
                self.assertTrue(chunk)
                headers += chunk
            self.assertIn(b'101 Switching Protocols', headers)
            payload = b'hello'
            mask = bytes([1, 2, 3, 4])
            connection.sendall(bytes([0x81, 0x80 | len(payload)]) + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(payload)))
            expected = bytes([0x81, len(payload)]) + payload
            received = b''
            while len(received) < len(expected):
                chunk = connection.recv(len(expected) - len(received))
                self.assertTrue(chunk)
                received += chunk
            self.assertEqual(expected, received)
        self.assertEqual('/hub/socket?access_token=fixture', self.fixture.last_websocket_path)
        self.assertEqual('/health/ready', self.fixture.last_probe['path'])
        self.assertIsNone(self.fixture.last_probe['upgrade'])
        self.fixture.set_mode('starting')
        self.assertEqual(503, self.fixture.request('/hub/socket', headers={'Upgrade': 'websocket', 'Connection': 'Upgrade'})[0])

    def test_application_errors_and_missing_assets_keep_their_status(self):
        self.assertEqual(401, self.fixture.request('/api/private')[0])
        status, headers, _ = self.fixture.request('/api/business503')
        self.assertEqual(503, status)
        self.assertEqual('available', headers['X-Resonance-Site-State'])
        self.assertEqual(404, self.fixture.request('/static/missing.js')[0])

    def test_missing_frontend_has_independent_page_but_native_api_stays_available(self):
        index = self.fixture.web / 'index.html'
        saved = index.read_bytes()
        index.unlink()
        try:
            for path in ['/library', '/__site/status']:
                status, headers, _ = self.fixture.request(path)
                self.assertEqual(503, status)
                self.assertEqual('frontend-unavailable', headers['X-Resonance-Site-State'])
            self.assertEqual(200, self.fixture.request('/api/echo')[0])
        finally:
            index.write_bytes(saved)

    def test_browser_failure_or_monitor_outage_gates_only_the_web(self):
        for mode in ['unavailable', 'offline', 'unexpected']:
            self.fixture.frontend_mode = mode
            for path in ['/library', '/__site/status', '/__site/readiness']:
                status, headers, _ = self.fixture.request(path)
                self.assertEqual(503, status)
                self.assertEqual('frontend-unavailable', headers['X-Resonance-Site-State'])
            self.assertEqual(200, self.fixture.request('/api/echo')[0])
            self.assertEqual(200, self.fixture.request('/hub/stream')[0])
            self.assertEqual(200, self.fixture.request('/__site/live')[0])
        self.fixture.frontend_mode = 'ready'
        self.assertEqual(200, self.fixture.request('/__site/status')[0])

    def test_loopback_probe_can_verify_recovery_without_opening_public_maintenance(self):
        self.fixture.frontend_mode = 'unavailable'
        self.control.set_state(self.fixture.state, 'maintenance')
        with urllib.request.urlopen(self.fixture.probe_origin + '/library', timeout=8) as response:
            self.assertIn(b'APP_READY', response.read())
        self.assertEqual('maintenance', self.fixture.request('/library')[1]['X-Resonance-Site-State'])
        self.control.set_state(self.fixture.state, 'normal')
        self.assertEqual('frontend-unavailable', self.fixture.request('/library', headers={'X-Resonance-Probe': 'true'})[1]['X-Resonance-Site-State'])

    def test_frontend_probe_does_not_receive_credentials_and_preserves_degraded_state(self):
        self.fixture.set_mode('degraded')
        status, headers, _ = self.fixture.request('/library', headers={'Authorization': 'Bearer fixture', 'Cookie': 'session=fixture', 'X-Api-Key': 'fixture', 'X-Resonance-Link-Token': 'fixture'})
        self.assertEqual(200, status)
        self.assertEqual('degraded', headers['X-Resonance-Site-State'])
        self.assertEqual({key: None for key in ['Authorization', 'Cookie', 'X-Api-Key', 'X-Resonance-Link-Token']}, self.fixture.last_frontend_probe)


if __name__ == '__main__':
    unittest.main()
