"""Run one model at a time on CUDA, with a reliable CPU fallback."""

import fcntl
import gc
import os
from pathlib import Path
import stat


def _gpu_lock(path):
    flags = os.O_CREAT | os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise OSError('GPU lock file is not private')
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def run_with_gpu_fallback(torch, infer, lock_path):
    """Return (result, device, attempted, fallback reason, peak bytes).

    The lock is shared by worker processes in one app data directory. A killed
    process releases it automatically. CUDA failures retry inference on CPU.
    """
    if not torch.cuda.is_available():
        return infer('cpu'), 'cpu', False, None, 0

    fallback = None
    descriptor = None
    try:
        descriptor = _gpu_lock(lock_path)
        if not torch.cuda.is_available():
            fallback = 'CudaUnavailable'
        else:
            try:
                torch.cuda.reset_peak_memory_stats()
                result = infer('cuda')
                peak = torch.cuda.max_memory_allocated()
                gc.collect()
                torch.cuda.empty_cache()
                return result, 'cuda', True, None, peak
            except RuntimeError as error:
                fallback = type(error).__name__
    except OSError:
        fallback = 'GpuLockUnavailable'
    finally:
        if descriptor is not None:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    gc.collect()
    torch.cuda.empty_cache()
    return infer('cpu'), 'cpu', True, fallback, 0


def lock_path_for_model(model_root):
    """Keep the GPU lock in writable app data beside its runtime bundle."""
    return Path(model_root).resolve().parents[2] / '.gpu.lock'
