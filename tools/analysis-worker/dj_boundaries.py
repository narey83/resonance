"""Conservative DJ-only timing refinement; musical model output is left intact.

A musical section's opening crash is not proof that its whole span is a buildup.
Split only a sustained quiet drum interval followed by a sustained return. This
is acoustic evidence, not a calibrated claim about musical phrase correctness.
"""
import copy
import math
import statistics


def refine_dj_boundaries(profile, bins, duration, downbeats):
    result = copy.deepcopy(profile)
    grid = [float(t) for t in (downbeats or [])]
    if len(grid) < 8 or any(not math.isfinite(t) or t < 0 or t > duration for t in grid) or any(b <= a for a, b in zip(grid, grid[1:])):
        result['boundaryRefinement'] = {'status': 'not-run', 'reason': 'valid downbeat grid required'}
        return result
    bar = statistics.median(b-a for a, b in zip(grid, grid[1:]))
    samples = [(float(b['startSeconds']), float(b['rms'])) for b in bins]
    if not samples or any(not math.isfinite(t) or not math.isfinite(v) or v < 0 for t, v in samples) or any(b[0] <= a[0] for a, b in zip(samples, samples[1:])):
        raise ValueError('Ordered finite nonnegative percussion samples required')
    def mean(lo, hi):
        total = weight = 0.0
        for i, (t, value) in enumerate(samples):
            end = samples[i+1][0] if i+1 < len(samples) else duration
            overlap = max(0.0, min(end, hi)-max(t, lo))
            total += value*overlap
            weight += overlap
        return total/weight if weight else 0.0
    active = sorted(v for _, v in samples)[int((len(samples)-1)*.75)]
    quiet = max(.0003, active*.04)
    rows = copy.deepcopy(profile.get('segments', []))
    changes = []
    # Only nearby downbeats; do not force all arrangements onto 8/16/32-bar blocks.
    for i in range(1, len(rows)):
        original = float(rows[i]['start_seconds'])
        nearest = min(grid, key=lambda t: abs(t-original))
        if abs(nearest-original) <= min(.5, bar*.25) and nearest-rows[i-1]['start_seconds'] >= 2 and rows[i]['end_seconds']-nearest >= 2:
            rows[i-1]['end_seconds'] = nearest
            rows[i]['start_seconds'] = nearest
            if abs(nearest-original) > .001:
                changes.append({'kind': 'nearby-downbeat', 'fromSeconds': original, 'toSeconds': nearest})
    refined = []
    for row in rows:
        lo, hi = row['start_seconds'], row['end_seconds']
        bars = [(a, b, mean(a, b)) for a, b in zip(grid, grid[1:]) if a >= lo-.02 and b <= hi+.02 and .6*bar <= b-a <= 1.4*bar]
        split = None
        if row['label'] == 'Buildup' and len(bars) >= 8:
            run = 0
            for i, (a, b, value) in enumerate(bars):
                if value < quiet:
                    run += 1
                    continue
                after = [v for _, _, v in bars[i:i+3]]
                if run >= 4 and len(after) == 3 and min(after) >= quiet and max(v for _, _, v in bars[i:]) >= quiet*4 and a-lo >= bar*4 and hi-a >= bar*3:
                    split = a
                run = 0
        if split is not None:
            refined.append(dict(row, end_seconds=split, label='Breakdown'))
            refined.append(dict(row, start_seconds=split))
            changes.append({'kind': 'quiet-leading-buildup', 'fromSeconds': lo, 'toSeconds': split, 'quietThresholdRms': quiet})
        else:
            refined.append(row)
    merged = []
    for row in refined:
        if merged and merged[-1]['label'] == row['label'] and abs(merged[-1]['end_seconds']-row['start_seconds']) < .02:
            previous = merged[-1]
            previous['end_seconds'] = row['end_seconds']
        else:
            merged.append(row)
    # Recompute displayed acoustic summaries after changing the interval geometry.
    for row in merged:
        row['percussionRms'] = mean(row['start_seconds'], row['end_seconds'])
        row['bassRms'] = None  # Previous interval's bass summary no longer describes this span.
        row['sourceSectionCount'] = sum(s['start_seconds'] < row['end_seconds'] and s['end_seconds'] > row['start_seconds'] for s in profile.get('sourceSections', profile.get('segments', [])))
        for key in ['percussionHeadRms', 'percussionTailRms', 'percussionRiseRatio']:
            row.pop(key, None)
    result.update(segments=merged, revision='energy-transitions-v4')
    result['boundaryRefinement'] = {'status': 'applied', 'changes': changes, 'maxSnapSeconds': min(.5, bar*.25), 'quietRunMinimumBars': 4, 'returnMinimumBars': 3, 'semantics': 'Nearby detected downbeats plus sustained percussion evidence; no fixed phrase length and no accuracy guarantee'}
    result['limitations'] = list(result.get('limitations', [])) + ['Boundary refinement can miss melodic buildups without a drum rise; listening review remains necessary']
    return result
