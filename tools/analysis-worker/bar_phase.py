"""Optional global-meter assumption, independent of any reference beat labels.

This is a Resonance design experiment, not recovered Rekordbox behavior.
A global phase cannot model changing meter, missing/extra beats or phase changes.
"""
import numpy as np

def choose_global_bar_phase(beats_seconds, downbeat_logits, fps=50, beats_per_bar=4):
    beats = np.asarray(beats_seconds, dtype=float)
    logits = np.asarray(downbeat_logits, dtype=float).reshape(-1)
    if beats_per_bar < 2 or not len(beats) or not len(logits):
        raise ValueError('Expected beats, logits, and beats_per_bar >=2')
    indices = np.clip(np.rint(beats * fps).astype(int), 0, len(logits)-1)
    # Stable sigmoid and clipped Bernoulli likelihood, sampled exactly at beats.
    z = np.clip(logits[indices], -700, 700)
    p = np.clip(1 / (1 + np.exp(-z)), 1e-7, 1-1e-7)
    scores = []
    for phase in range(beats_per_bar):
        selected = np.arange(len(beats)) % beats_per_bar == phase
        scores.append(float(np.where(selected, np.log(p), np.log1p(-p)).sum()))
    order = np.argsort(scores)[::-1]
    chosen = int(order[0])
    return {
        'assumption': 'One constant global meter and phase across complete detected beat sequence',
        'beats_per_bar': beats_per_bar, 'phase_index': chosen,
        'downbeats_seconds': beats[np.arange(len(beats)) % beats_per_bar == chosen].tolist(),
        'phase_log_likelihoods': scores,
        'score_margin': float(scores[chosen] - scores[int(order[1])]),
        'score_semantics': 'Difference of uncalibrated Bernoulli loglikelihood phase scores; not probability or confidence',
    }
