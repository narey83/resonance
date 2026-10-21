"""Audio-independent summaries of an inferred beat grid, without reference labels."""
import numpy as np


def summarize_tempo(beats_seconds, span_beats=8):
    beats = np.asarray(beats_seconds, dtype=float)
    if beats.ndim != 1 or not np.isfinite(beats).all() or np.any(np.diff(beats) <= 0):
        raise ValueError('Expected finite strictly increasing beat timestamps')
    if not isinstance(span_beats, int) or isinstance(span_beats, bool) or span_beats < 1:
        raise ValueError('span_beats must be a positive integer')
    if len(beats) < 2:
        return {'bpm_multi_interval': None, 'tempo_windows': [], 'tempo_variation_ratio': None}
    span = min(span_beats, len(beats) - 1)
    periods = (beats[span:] - beats[:-span]) / span
    bpms = 60 / periods
    low, high = np.percentile(bpms, [10, 90])
    return {
        'bpm_multi_interval': float(60 / np.median(periods)),
        'tempo_span_beats': span,
        'tempo_variation_ratio': float(high / low),
        'tempo_windows': [
            {'start_seconds': float(beats[i]), 'end_seconds': float(beats[i + span]),
             'bpm': float(bpms[i])}
            for i in range(0, len(bpms), span)
        ],
        'tempo_summary_semantics': 'Median duration per beat over overlapping multi-beat spans; reduces timestamp quantization. Local tempo windows retain changes. Missed or extra beats can bias estimates; variation is not calibrated confidence.',
    }
