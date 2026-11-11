import tempfile
from pathlib import Path
import unittest

from gpu_runtime import run_with_gpu_fallback


class FakeCuda:
    def __init__(self, available):
        self.available = available
        self.clears = 0

    def is_available(self):
        return self.available

    def reset_peak_memory_stats(self):
        pass

    def max_memory_allocated(self):
        return 1234

    def empty_cache(self):
        self.clears += 1


class FakeTorch:
    def __init__(self, available):
        self.cuda = FakeCuda(available)


class GpuRuntimeTests(unittest.TestCase):
    def test_uses_cpu_when_cuda_is_unavailable(self):
        torch = FakeTorch(False)
        calls = []
        result = run_with_gpu_fallback(torch, lambda device: calls.append(device) or 'ok', '/unused')
        self.assertEqual(result, ('ok', 'cpu', False, None, 0))
        self.assertEqual(calls, ['cpu'])

    def test_uses_gpu_when_available(self):
        with tempfile.TemporaryDirectory() as temporary:
            torch = FakeTorch(True)
            calls = []
            result = run_with_gpu_fallback(torch, lambda device: calls.append(device) or 'ok', Path(temporary) / 'gpu.lock')
            self.assertEqual(result, ('ok', 'cuda', True, None, 1234))
            self.assertEqual(calls, ['cuda'])
            self.assertEqual(torch.cuda.clears, 1)

    def test_retries_on_cpu_after_gpu_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            torch = FakeTorch(True)
            calls = []

            def infer(device):
                calls.append(device)
                if device == 'cuda':
                    raise RuntimeError('simulated CUDA failure')
                return 'ok'

            result = run_with_gpu_fallback(torch, infer, Path(temporary) / 'gpu.lock')
            self.assertEqual(result, ('ok', 'cpu', True, 'RuntimeError', 0))
            self.assertEqual(calls, ['cuda', 'cpu'])
            self.assertEqual(torch.cuda.clears, 1)

    def test_unsafe_gpu_lock_falls_back_to_cpu(self):
        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary) / 'gpu.lock'
            lock.write_text('')
            lock.chmod(0o666)
            torch = FakeTorch(True)
            result = run_with_gpu_fallback(torch, lambda device: device, lock)
            self.assertEqual(result, ('cpu', 'cpu', True, 'GpuLockUnavailable', 0))


if __name__ == '__main__':
    unittest.main()
