"""Exercise the real hook in disposable Git repositories with fake external tools."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


HOOK = Path(__file__).with_name("pre-commit").resolve()


class PreCommitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tools = self.root / "fake-tools"
        self.tools.mkdir()
        self.env = {**os.environ, "PATH": str(self.tools) + os.pathsep + os.environ["PATH"]}
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.write("resonance.sln", "")
        self.write("backend/Example.cs", "staged source")
        self.git("add", "resonance.sln", "backend/Example.cs")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True)

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def tool(self, name, body):
        path = self.tools / name
        path.write_text("#!/usr/bin/env python3\n" + body)
        path.chmod(0o755)

    def run_hook(self):
        return subprocess.run(
            [str(HOOK)], cwd=self.root, env=self.env, text=True, capture_output=True
        )

    def test_stylecop_warning_blocks_successful_build(self):
        self.tool("dotnet", "print('Example.cs(1,1): warning SA1202: member order')\n")
        result = self.run_hook()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("Pre-commit checks failed", result.stdout)

    def test_non_stylecop_warning_does_not_block(self):
        self.tool("dotnet", "print('warning CS1591: documentation')\n")
        self.assertEqual(self.run_hook().returncode, 0)

    def test_build_failure_blocks_commit(self):
        self.tool("dotnet", "raise SystemExit(1)\n")
        self.assertEqual(self.run_hook().returncode, 1)

    def test_staged_snapshot_is_checked_and_unstaged_work_preserved(self):
        self.write("backend/Example.cs", "unstaged fix")
        self.tool("dotnet", """import pathlib, sys
snapshot = pathlib.Path(sys.argv[2]).parent
assert (snapshot / "backend/Example.cs").read_text() == "staged source"
assert "--configuration" in sys.argv and "Release" in sys.argv
assert "--artifacts-path" in sys.argv
""")
        result = self.run_hook()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.root / "backend/Example.cs").read_text(), "unstaged fix")

    def test_commonjs_and_json_with_spaces_reach_eslint(self):
        self.tool("dotnet", "pass\n")
        self.write("frontend/scripts/test file.cjs", "broken")
        self.write("frontend/package.json", "{}")
        self.git("add", "frontend")
        eslint = self.write("frontend/node_modules/.bin/eslint", """#!/usr/bin/env python3
import sys
assert sys.argv[1:] == ["--", "package.json", "scripts/test file.cjs"], sys.argv
raise SystemExit(1)
""")
        eslint.chmod(0o755)
        result = self.run_hook()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("Checking staged frontend", result.stdout)

    def test_missing_eslint_blocks_commit(self):
        self.tool("dotnet", "pass\n")
        self.write("mobile/tests/example.cjs", "")
        self.git("add", "mobile")
        result = self.run_hook()
        self.assertEqual(result.returncode, 1)
        self.assertIn("npm ci", result.stdout)


if __name__ == "__main__":
    unittest.main()
