import copy
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import yaml

import configure
import provision


class NativeAnalysisTests(unittest.TestCase):
    def test_read_only_gate_rejects_old_installer_and_accepts_locked_installer(self):
        versions = dict(provision.re.findall(r'^([\w-]+)==([^\s]+)',
                                             (provision.HERE / 'requirements.txt').read_text(),
                                             provision.re.MULTILINE))
        for installer, expected in (({'pip': '25.1.1'}, False), ({'pip': '26.2'}, True)):
            result = {**self.result, 'packages': versions, 'installer': installer}
            runner = lambda *a, **k: SimpleNamespace(stdout=provision.SENTINEL + json.dumps(result))
            if expected:
                self.assertEqual(result, provision.check(Path('/python'), runner=runner))
            else:
                with self.assertRaisesRegex(RuntimeError, 'Installer tooling'):
                    provision.check(Path('/python'), runner=runner)

    def test_provision_updates_hash_locked_installer_before_detector_packages(self):
        with tempfile.TemporaryDirectory() as temporary:
            environment = Path(temporary)
            (environment / 'pyvenv.cfg').touch()
            with patch('sys.argv', ['provision.py', '--venv', temporary]), \
                    patch.object(provision.sys, 'version_info', (3, 14)), \
                    patch.object(provision.sys, 'platform', 'linux'), \
                    patch.object(provision.platform, 'machine', return_value='x86_64'), \
                    patch.object(provision.subprocess, 'run') as run, \
                    patch.object(provision, 'check', return_value={}), patch('builtins.print'):
                provision.main()
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual([str(provision.HERE / name) for name in
                              ('installer-requirements.txt', 'requirements.txt')],
                             [command[-1] for command in commands])
            for command in commands:
                self.assertIn('--require-hashes', command)
                self.assertIn('--only-binary=:all:', command)

    def setUp(self):
        self.versions = {'essentia': 'locked'}
        self.result = {'bpm': 120, 'key': 'A', 'scale': 'major', 'beats': 58,
                       'packages': self.versions}

    def test_waveform_and_lufs_without_bpm_or_key_fail_the_preflight(self):
        for missing in ({'bpm': None}, {'bpm': 0}, {'bpm': float('nan')},
                        {'key': ''}, {'key': None}, {'beats': 0}):
            with self.subTest(missing=missing), self.assertRaisesRegex(RuntimeError, 'incomplete'):
                provision.validate_probe({**self.result, 'waveform': True, 'lufs': -7.5, **missing}, self.versions)

    def test_complete_detector_result_passes_and_drifted_dependencies_fail(self):
        provision.validate_probe(self.result, self.versions)
        with self.assertRaisesRegex(RuntimeError, 'lockfile'):
            provision.validate_probe(self.result, {'essentia': 'different'})

    def test_missing_interpreter_and_missing_native_modules_fail_closed(self):
        for error in (FileNotFoundError(), subprocess.CalledProcessError(1, ['python'])):
            def run(*args, **kwargs):
                raise error
            with self.subTest(error=error), self.assertRaisesRegex(RuntimeError, 'unavailable'):
                provision.check(Path('/missing/python'), runner=run)

    def test_import_only_output_is_not_accepted_as_a_detector_test(self):
        with self.assertRaisesRegex(RuntimeError, 'verified result'):
            provision.check(Path('/python'), runner=lambda *a, **k: SimpleNamespace(stdout='import succeeded'))

    def api_fixture(self):
        original = {'soulseek': {'description': 'keep me'}, 'analysis': {'write_to_tags': False},
                    'web': {'authentication': {'example_private_setting': 'preserved'}}}
        state = {'document': copy.deepcopy(original), 'writes': 0, 'conflict': False}
        reads = 0

        def api(path, method='GET', body=None):
            nonlocal reads
            if path == 'options/yaml/validate':
                return None
            if path == 'options':
                return {'analysis': {'essentiaPython': state['document']['analysis']['essentia_python']}}
            self.assertEqual(path, 'options/yaml')
            if method == 'PUT':
                state['document'] = yaml.safe_load(body)
                state['writes'] += 1
                return None
            reads += 1
            if state['conflict'] and reads == 2:
                return 'concurrent: edit\n'
            return yaml.safe_dump(state['document'])

        return original, state, api

    def test_verified_path_is_persistent_and_preserves_all_other_settings(self):
        original, state, api = self.api_fixture()
        with tempfile.TemporaryDirectory() as temporary:
            private = Path(temporary) / 'private'
            self.assertTrue(configure.configure(api, Path('/native/bin/python'), private))
            expected = copy.deepcopy(original)
            expected['analysis']['essentia_python'] = '/native/bin/python'
            self.assertEqual(state['document'], expected)
            backup = next(private.glob('*.yml'))
            self.assertEqual(yaml.safe_load(backup.read_text()), original)
            self.assertEqual(backup.stat().st_mode & 0o077, 0)
            self.assertFalse(configure.configure(api, Path('/native/bin/python'), private))
            self.assertEqual(state['writes'], 1)

    def test_concurrent_settings_change_is_not_overwritten(self):
        original, state, api = self.api_fixture()
        state['conflict'] = True
        with tempfile.TemporaryDirectory() as temporary, self.assertRaisesRegex(RuntimeError, 'Settings changed'):
            configure.configure(api, Path('/native/bin/python'), Path(temporary) / 'private')
        self.assertEqual(state['document'], original)
        self.assertEqual(state['writes'], 0)

    def test_saved_path_is_not_enough_when_the_running_configuration_differs(self):
        _, state, api = self.api_fixture()
        state['document']['analysis']['essentia_python'] = '/native/bin/python'

        def stale_api(path, method='GET', body=None):
            return {'analysis': {'essentiaPython': '/opt/keyenv/bin/python'}} if path == 'options' else api(path, method, body)

        with tempfile.TemporaryDirectory() as temporary, self.assertRaisesRegex(RuntimeError, 'running configuration'):
            configure.configure(stale_api, Path('/native/bin/python'), Path(temporary) / 'private')
        self.assertEqual(state['writes'], 0)

    def test_administrator_authorization_requires_secure_or_loopback_transport(self):
        for url in ('https://resonance.example', 'http://127.0.0.1:55450', 'http://localhost:55450'):
            configure.validate_url(url)
        for url in ('http://192.168.1.1', 'http://remote.example', 'https://user:secret@example.org',
                    'https://example.org?token=secret', 'file:///tmp/settings'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                configure.validate_url(url)
        with self.assertRaisesRegex(RuntimeError, 'redirect'):
            configure.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.example')


if __name__ == '__main__':
    unittest.main()
