"""Portable deployment tests never mount host filesystems or touch live state."""

import importlib.util
import json
import sqlite3
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
