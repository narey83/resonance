import sys, json
import numpy as np
import essentia
essentia.log.infoActive = False
essentia.log.warningActive = False
import essentia.standard as es

SHARP = {'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#'}
profile, method, max_secs, want = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]

raw = sys.stdin.buffer.read()
audio = np.frombuffer(raw, dtype=np.float32).copy()
limit = int(max_secs * 44100)
if limit and len(audio) > limit:
    audio = audio[:limit]

out = {}
if len(audio) >= 44100:
    if 'key' in want:
        try:
            k, scale, _ = es.KeyExtractor(profileType=profile)(audio)
            out['key'] = SHARP.get(k, k) + ('m' if scale == 'minor' else '')
        except Exception as e:
            out['keyError'] = str(e)
    if 'bpm' in want:
        try:
            bpm, ticks, conf, _, _ = es.RhythmExtractor2013(method=method)(audio)
            out['bpm'] = float(bpm)
            out['bpmConfidence'] = float(conf)
            beats = [float(t) for t in ticks]
            if beats:
                # beats[0] is the first detected beat, in seconds from the start
                # of this decode — the beat-grid phase/origin, not just the
                # interval. The full list is kept too (below) so the frontend can
                # show actual detected beats distinctly from the theoretical grid
                # beatOffset/bpm imply.
                out['beatOffset'] = beats[0]
                out['beats'] = beats

            # Downbeat: no dedicated detector is available in this Essentia build
            # (Meter() exists but its own docstring says "experimental, do not
            # use"; there is nothing like madmom's DBNDownBeatTracker here). This
            # is a heuristic built on BeatsLoudness (a real, non-experimental
            # primitive): average each beat's energy by its position in a 4-beat
            # cycle, and take the loudest phase as the downbeat candidate.
            # Deliberately weak on four-on-the-floor house/techno, where every
            # beat carries a kick and all four phases read equally loud —
            # downbeatConfidence is designed to come out low there rather than
            # assert a guess, since the margin between the best and next-best
            # phase is the whole signal.
            if len(beats) >= 8:
                try:
                    loudness, _ = es.BeatsLoudness(beats=beats)(audio)
                    sums = [0.0, 0.0, 0.0, 0.0]
                    counts = [0, 0, 0, 0]
                    for i, l in enumerate(loudness):
                        phase = i % 4
                        sums[phase] += float(l)
                        counts[phase] += 1
                    averages = [s / c if c else 0.0 for s, c in zip(sums, counts)]
                    ranked = sorted(range(4), key=lambda p: averages[p], reverse=True)
                    best, runner_up = ranked[0], ranked[1]
                    out['downbeatOffset'] = beats[best]
                    total = averages[best] + 1e-9
                    out['downbeatConfidence'] = max(
                        0.0, min(1.0, (averages[best] - averages[runner_up]) / total))
                except Exception as e:
                    out['downbeatError'] = str(e)
        except Exception as e:
            out['bpmError'] = str(e)

sys.stdout.write('RESONANCE_JSON:' + json.dumps(out) + '\n')