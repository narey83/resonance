"""Portable CPU allocation for isolated analysis model processes."""

import os


def available_processors():
    """Return processors granted to this process, respecting affinity where available."""
    try:
        return max(1, len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):
        return max(1, os.cpu_count() or 1)


def analysis_threads():
    raw = os.environ.get("RESONANCE_ANALYSIS_THREADS")
    if raw is None:
        return available_processors()
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError("RESONANCE_ANALYSIS_THREADS must be a positive integer") from error
    if value < 1:
        raise ValueError("RESONANCE_ANALYSIS_THREADS must be a positive integer")
    return min(value, available_processors())


def configure_torch(torch):
    """Apply the parent scheduler's per-job CPU allocation to a fresh PyTorch process."""
    threads = analysis_threads()
    torch.set_num_threads(threads)
    try:
        torch.set_num_interop_threads(max(1, min(2, threads)))
    except RuntimeError:
        # PyTorch permits setting this only before inter-op work starts. Some imported model
        # packages perform harmless initialization first; intra-op allocation still applies.
        pass
    return threads
