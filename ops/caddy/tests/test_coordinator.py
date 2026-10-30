"""The optional restart coordinator follows Caddy, not its own health policy."""

import importlib.util
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import URLError

from fixture import ROOT


class CoordinatorReadinessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        spec = importlib.util.spec_from_file_location('caddy_coordinator', ROOT / 'docker/maintenance/maintenance.py')
        cls.module = importlib.util.module_from_spec(spec)
        with patch.dict('os.environ', {'STATE_DIR': cls.directory.name}):
            spec.loader.exec_module(cls.module)
        cls.module.CADDY_READINESS = 'http://127.0.0.1:8080/__site/readiness'

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_only_caddy_can_release_the_restart_marker(self):
        cases = [(200, 'caddy', 'available', True), (200, 'caddy', 'degraded', True), (503, 'caddy', 'starting', False), (200, 'other', 'available', False), (200, 'caddy', 'unknown', False)]
        for status, gateway, state, expected in cases:
            with self.subTest(status=status, gateway=gateway, state=state):
                response = MagicMock()
                response.status = status
                response.headers = {'X-Resonance-Gateway': gateway, 'X-Resonance-Site-State': state}
                response.__enter__.return_value = response
                with patch.object(self.module, 'urlopen', return_value=response) as request:
                    self.assertEqual(expected, self.module.backend_ready())
                    self.assertEqual(1, request.call_count)
                    self.assertEqual(self.module.CADDY_READINESS, request.call_args.args[0].full_url)

    def test_caddy_outage_never_releases_a_restart(self):
        with patch.object(self.module, 'urlopen', side_effect=URLError('unreachable')):
            self.assertFalse(self.module.backend_ready())
