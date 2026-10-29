"""Portable deployment tests never mount host filesystems or touch live state."""

import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


sys.path.insert(0, str(ROOT / "docker"))
bootstrap = module("bootstrap", "docker/bootstrap.py")
updater = module("updater", "docker/update-frontend.py")
logs = module("runtime_logs", "docker/collect-runtime-logs.py")
relocation = module("relocation", "docker/scripts/relocate-instance-settings.py")
guard = module("guard", "docker/scripts/music-mount-guard.py")
state = module("state", "docker/export-state.py")
smb = module("docker_smb_test", "docker/scripts/docker_smb.py")
configuration = module("configuration", "docker/scripts/configure-analysis-worker.py")


class PortableStackTests(unittest.TestCase):
    def test_host_network_is_explicit_and_adds_override(self):
        environment = Path("/private/compose.env")
        command = bootstrap.compose_command(environment)
        self.assertNotIn(str(ROOT / "docker/compose.host-network.yml"), command)
        command = bootstrap.compose_command(environment, True)
        self.assertEqual(
            command[-2:], ["-f", str(ROOT / "docker/compose.host-network.yml")]
        )

    def test_mount_guard_rejects_empty_local_music_directory(self):
        mounts = "1 0 0:1 / / rw - overlay overlay rw\n2 1 8:1 /state /config rw - ext4 /dev/sda rw\n3 1 8:1 /empty /downloads rw - ext4 /dev/sda rw"
        with self.assertRaisesRegex(RuntimeError, "SMB music share"):
            guard.validate(mounts, "cifs")
        guard.validate(
            mounts.replace(
                "3 1 8:1 /empty /downloads rw - ext4 /dev/sda rw",
                "3 1 0:4 / /downloads rw - cifs //server/music rw",
            ),
            "cifs",
        )

    def test_mount_guard_rejects_sqlite_on_network_storage(self):
        mounts = "1 0 0:1 / / rw - overlay overlay rw\n2 1 0:2 / /config rw - cifs //server/state rw\n3 1 0:3 / /downloads rw - cifs //server/music rw"
        with self.assertRaisesRegex(RuntimeError, "local disk"):
            guard.validate(mounts, "cifs")

    def test_longest_mount_match_and_escaped_paths(self):
        mounts = "1 0 0:1 / / rw - overlay overlay rw\n2 1 8:1 / /a\\040b rw - ext4 /dev/sda rw\n3 2 0:2 / /a\\040b/music rw - cifs //server/music rw"
        self.assertEqual(guard.filesystem("/a b/music/song.mp3", mounts), "cifs")
        self.assertEqual(guard.filesystem("/a bc", mounts), "overlay")

    def test_tls_proxy_is_optional_and_adds_separate_override(self):
        environment = Path("/private/compose.env")
        command = bootstrap.compose_command(environment, True, True)
        self.assertEqual(command[-2:], ["-f", str(ROOT / "docker/compose.tls.yml")])
        self.assertIn(str(ROOT / "docker/compose.host-network.yml"), command)

    def test_posix_music_mount_is_opt_in(self):
        account = {"username": "fixture", "password": "fixture-only"}
        standard = smb.volume_definition(
            "//server/music", account, 1000, 1000, "192.0.2.1"
        )
        posix = smb.volume_definition(
            "//server/music", account, 1000, 1000, "192.0.2.1", posix=True
        )
        self.assertNotIn("posix", standard["o"].split(","))
        self.assertIn("posix", posix["o"].split(","))
        self.assertIn("seal", posix["o"].split(","))

    def test_frontend_update_refreshes_proxy_without_backend_build(self):
        commands = updater.build_commands(
            {"tlsEnabled": True, "tlsImage": "proxy:fixture"}
        )
        self.assertIn("--pull", commands[0])
        self.assertIn("--no-cache", commands[0])
        self.assertNotIn("--pull", commands[1])
        self.assertIn("CADDY_RUNTIME_IMAGE=proxy:fixture", commands[1])
        self.assertFalse(any("docker/prod.Dockerfile" in cmd for cmd in commands))
        self.assertFalse(
            any("docker/analysis-worker.Dockerfile" in cmd for cmd in commands)
        )

    def test_quick_frontend_update_reuses_proxy_and_build_cache(self):
        commands = updater.build_commands(
            {"tlsEnabled": True, "tlsImage": "proxy:fixture"}, quick=True
        )
        self.assertEqual(len(commands), 1)
        self.assertNotIn("--pull", commands[0])
        self.assertNotIn("--no-cache-filter", commands[0])
        self.assertIn("CADDY_RUNTIME_IMAGE=proxy:fixture", commands[0])

    def test_frontend_validation_failure_restores_image_without_activation(self):
        calls = []

        def run(command):
            calls.append(command)
            if "validate" in command:
                raise subprocess.CalledProcessError(1, command)

        with self.assertRaises(subprocess.CalledProcessError):
            updater.update({}, Path("/private/compose.env"), run)
        self.assertEqual(calls[-1][:3], ["docker", "image", "tag"])
        self.assertEqual(calls[-1][-1], "resonance-web:portable")
        self.assertFalse(any("compose" in c for c in calls))

    def test_frontend_health_failure_rolls_back_only_frontend(self):
        calls = []
        failed = False

        def run(command):
            nonlocal failed
            calls.append(command)
            if "compose" in command and not failed:
                failed = True
                raise subprocess.CalledProcessError(1, command)

        with self.assertRaises(subprocess.CalledProcessError):
            updater.update({}, Path("/private/compose.env"), run)
        activations = [c for c in calls if "compose" in c]
        self.assertEqual(len(activations), 2)
        self.assertTrue(all(c[-1] == "web" and "--no-deps" in c for c in activations))

    def test_diagnostic_bundle_redacts_headers_queries_and_known_secrets(self):
        text = "2026-10-27T00:00:00Z " + json.dumps(
            {
                "level": "error",
                "request": {
                    "headers": {
                        "Authorization": "Bearer fixture",
                        "X-Resonance-Link-Token": "fixture-pairing",
                    },
                    "uri": "/hub?access_token=fixture-jwt",
                },
                "message": "fixture-private-value",
            }
        )
        result = logs.redact(text, ["fixture-private-value"])
        for value in (
            "fixture-pairing",
            "fixture-jwt",
            "fixture-private-value",
            "Bearer fixture",
        ):
            self.assertNotIn(value, result)
        self.assertIn("[REDACTED]", result)

    def test_diagnostic_severity_uses_event_level_before_message_words(self):
        self.assertEqual(
            logs.severity("WRN [Shares] Error initializing shares"), "warning"
        )
        self.assertIsNone(
            logs.severity('{"level":"info","msg":"previous error resolved"}')
        )
        self.assertEqual(
            logs.severity('{"level":"error","msg":"upstream failed"}'), "error"
        )

    def test_instance_relocation_preserves_custom_settings_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            data = Path(temporary)
            (data / "profile").mkdir()
            (data / "profile/avatar.jpg").write_bytes(b"fixture")
            values = {
                "resonance:integrations:yt_dlp:executable_path": "/src/backend/tools/yt-dlp",
                "resonance:integrations:yt_dlp:ffmpeg_path": "/opt/custom/ffmpeg",
                "resonance:dlna:bind_address": "192.0.2.1",
                "resonance:soulseek:picture": "/src/backend/data/profile/avatar.jpg",
            }
            with sqlite3.connect(data / "resonance.db") as c:
                c.execute('CREATE TABLE Setting ("Key" TEXT PRIMARY KEY, "Value" TEXT)')
                c.executemany("INSERT INTO Setting VALUES (?,?)", values.items())
            changes = relocation.relocate(data, "192.0.2.80")
            self.assertEqual(len(changes), 3)
            with sqlite3.connect(data / "resonance.db") as c:
                current = dict(c.execute('SELECT "Key","Value" FROM Setting'))
            self.assertEqual(
                current["resonance:integrations:yt_dlp:executable_path"], "yt-dlp"
            )
            self.assertEqual(
                current["resonance:integrations:yt_dlp:ffmpeg_path"],
                "/opt/custom/ffmpeg",
            )
            self.assertEqual(
                current["resonance:soulseek:picture"], "/config/data/profile/avatar.jpg"
            )
            self.assertEqual(relocation.relocate(data, "192.0.2.80"), [])
            backups = list(data.glob("instance-relocation-*.json"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)

    def test_proxy_trust_is_explicit_and_validates_networks(self):
        self.assertEqual(bootstrap.trusted_proxies(["192.0.2.1"]), "192.0.2.1/32")
        for value in ([], "private_ranges", ["192.0.2.1; bad"], ["invalid"]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                bootstrap.trusted_proxies(value)

    def test_source_and_environment_injection_rejected(self):
        for source in (
            "/local",
            "//server",
            "//server/share\n/dev/sda / ext4",
            "//server/share,password=bad",
        ):
            with self.subTest(source=source), self.assertRaises(ValueError):
                bootstrap.validate_source(source)
        for value in ("bad\nOTHER=1", "${TOKEN}", "some # comment"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                bootstrap.environment_text({"STATE_DIR": value})
        self.assertEqual(bootstrap.validate_source("//server/music"), "//server/music")

    def test_docker_volume_uses_smb3_and_keeps_credentials_out_of_environment(self):
        options = smb.volume_definition(
            "//server/music_network",
            {"username": "fixture", "password": "fixture-only"},
            1000,
            1000,
            "192.0.2.1",
        )
        self.assertEqual(options["device"], "//server/music_network")
        self.assertIn("vers=3.1.1", options["o"])
        self.assertIn("seal", options["o"])
        self.assertIn("password=fixture-only", options["o"])
        with self.assertRaises(ValueError):
            smb.volume_definition(
                "//server/music_network",
                {"username": "fixture", "password": "comma,unsupported"},
                1000,
                1000,
                "192.0.2.1",
            )

    def test_configuration_translates_all_model_and_worker_paths(self):
        example = json.loads(
            (ROOT / "tools/analysis-worker/config.example.json").read_text()
        )
        result = configuration.configuration(example)
        encoded = json.dumps(result)
        self.assertNotIn("/opt/resonance/models", encoded)
        self.assertNotIn("/opt/resonance/tools", encoded)
        self.assertTrue(
            result["semanticPhrases"]["ensembleManifest"].startswith(
                "/config/data/analysis-models/"
            )
        )
        self.assertEqual(result["key"]["python"], "/opt/keyenv/bin/python")
        self.assertEqual(
            example["key"]["python"], "/opt/resonance/venvs/essentia/bin/python"
        )

    def test_private_state_round_trip_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application = root / "source"
            data = application / "data"
            data.mkdir(parents=True)
            with sqlite3.connect(data / "resonance.db") as database:
                database.execute("CREATE TABLE example(value TEXT)")
                database.execute("INSERT INTO example VALUES (?)", ("retained",))
            (application / "resonance.yml").write_text("private settings fixture")
            for directory in (
                "sqlite-conversion-1",
                "sqlite-enable-20261025-211958",
                "sqlite-final-20261026-095038",
                "backups",
            ):
                historical = data / directory
                historical.mkdir()
                (historical / "resonance.db").write_bytes(b"historical backup")
            archive = root / "private.state.tar.gz"
            state.export_state(application, archive)
            self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
            target = root / "target"
            state.import_state(archive, target)
            for directory in (
                "sqlite-conversion-1",
                "sqlite-enable-20261025-211958",
                "sqlite-final-20261026-095038",
                "backups",
            ):
                self.assertFalse((target / "data" / directory).exists())
                self.assertTrue((data / directory / "resonance.db").exists())
            with sqlite3.connect(target / "data/resonance.db") as database:
                self.assertEqual(
                    database.execute("SELECT value FROM example").fetchone()[0],
                    "retained",
                )
            self.assertEqual(
                (target / "resonance.yml").read_text(), "private settings fixture"
            )
            state.import_state(archive, target)
            other = root / "other"
            (other / "data").mkdir(parents=True)
            (other / "data/resonance.db").write_bytes(b"existing")
            with self.assertRaisesRegex(ValueError, "preserved"):
                state.import_state(archive, other)

    def test_state_rejects_archive_inside_source_and_corrupt_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "outside"):
                state.export_state(root, root / "nested.tar.gz")
            archive = root / "corrupt.tar.gz"
            archive.write_bytes(b"not an archive")
            archive.with_name(archive.name + ".sha256").write_text("0" * 64)
            with self.assertRaisesRegex(ValueError, "checksum"):
                state.import_state(archive, root / "target")


if __name__ == "__main__":
    unittest.main()
