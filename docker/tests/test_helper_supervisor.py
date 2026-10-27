import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / 'scripts/with-helper.py'

class SupervisorTests(unittest.TestCase):
    def wait_for(self, condition):
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if condition():return
            time.sleep(.05)
        self.fail('Timed out waiting for child lifecycle')

    def test_restarts_helper_and_drains_both_on_container_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            child=root/'child.py'
            child.write_text("import os,sys,time\nfrom pathlib import Path\np=Path(sys.argv[1]);p.write_text(str(os.getpid()))\nwhile True:time.sleep(.1)\n")
            harness=root/'harness.py'
            harness.write_text(f"import importlib.util\ns=importlib.util.spec_from_file_location('supervisor',{str(SCRIPT)!r});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nraise SystemExit(m.run({[sys.executable,str(child),str(root/'main.pid')]!r},{[sys.executable,str(child),str(root/'helper.pid')]!r}))\n")
            proc=subprocess.Popen([sys.executable,str(harness)])
            try:
                self.wait_for(lambda:(root/'main.pid').exists() and (root/'helper.pid').exists())
                old=int((root/'helper.pid').read_text());main=int((root/'main.pid').read_text())
                os.kill(old,signal.SIGKILL)
                self.wait_for(lambda:int((root/'helper.pid').read_text() or '0') not in (0,old))
                helper=int((root/'helper.pid').read_text())
                proc.terminate();self.assertEqual(proc.wait(timeout=10),0)
                for pid in (main,helper):
                    with self.assertRaises(ProcessLookupError):os.kill(pid,0)
            finally:
                if proc.poll() is None:proc.kill();proc.wait()

    def test_provider_is_started_with_explicit_loopback_host(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('supervisor',SCRIPT)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'build').mkdir();(root/'build/main.js').touch();(root/'node').touch()
            from unittest.mock import patch
            with patch.dict(os.environ,{'RESONANCE_BGUTIL_ROOT':directory}):
                command,cwd=module.commands('backend')
                self.assertEqual(command[-2:],['--host','127.0.0.1'])
                self.assertEqual(cwd,directory)
