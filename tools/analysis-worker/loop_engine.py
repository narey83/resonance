"""Independent experimental beat-aligned loop proposals; scores are not confidence."""
import numbers
import numpy as np
VERSION = '0.1-experimental'

def propose_loops(audio, sample_rate, beats_seconds, downbeats_seconds=(), beat_counts=(4, 8, 16, 32), max_loops=12, min_rms_dbfs=-45):
    if isinstance(sample_rate, bool) or not isinstance(sample_rate, numbers.Real) or not np.isfinite(sample_rate) or sample_rate <= 0:
        raise ValueError('Positive finite sample rate required')
    x = np.asarray(audio, dtype=np.float64)
    if x.ndim != 1 or not len(x) or not np.isfinite(x).all():
        raise ValueError('Nonempty finite mono audio required')
    beats = np.asarray(beats_seconds, dtype=float)
    downbeats = np.asarray(downbeats_seconds, dtype=float)
    for name, values in [('beats', beats), ('downbeats', downbeats)]:
        if values.ndim != 1 or not np.isfinite(values).all() or (len(values) and (values[0] < 0 or np.any(np.diff(values) <= 0))):
            raise ValueError('Nonnegative strictly increasing '+name+' required')
    if not isinstance(max_loops, int) or isinstance(max_loops, bool) or not 1 <= max_loops <= 64:
        raise ValueError('max_loops must be 1..64')
    if not beat_counts or any(isinstance(v, bool) or not isinstance(v, int) or not 2 <= v <= 128 for v in beat_counts):
        raise ValueError('Loop lengths must be integer beat counts 2..128')
    if not np.isfinite(min_rms_dbfs) or not -120 <= min_rms_dbfs <= 0:
        raise ValueError('RMS floor must be -120..0 dBFS')
    duration = len(x)/sample_rate
    beats = beats[beats <= duration]
    samples = np.rint(beats*sample_rate).astype(int)
    starts = list(range(len(beats)))
    aligned = {i for i, value in enumerate(beats) if len(downbeats) and np.min(abs(downbeats-value)) <= .035}
    if aligned:
        starts = sorted(aligned)
    prefix = np.r_[0., np.cumsum(x*x)]
    floor = 10**(min_rms_dbfs/20)
    def spectrum(start, end):
        part = x[start:end]
        size = 2048
        if len(part) < 2:
            return np.zeros(size//2+1)
        part = np.interp(np.linspace(0, len(part)-1, size), np.arange(len(part)), part)
        spec = np.abs(np.fft.rfft(part*np.hanning(size)))
        return spec/(np.linalg.norm(spec)+1e-12)
    rows=[]
    for i in starts:
        for count in sorted(set(beat_counts)):
            j=i+count
            if j >= len(beats) or samples[j] <= samples[i]:
                continue
            a,b = samples[i],samples[j]
            edges = samples[i:j+1]
            if np.any(np.diff(edges) <= 0):
                continue
            rms = float(np.sqrt((prefix[b]-prefix[a])/(b-a)))
            if rms < floor:
                continue
            energies = np.sqrt(np.maximum(0, np.diff(prefix[edges]))/np.diff(edges))
            stability = float(1/(1+np.std(energies)/(np.mean(energies)+1e-12)))
            window = max(2, min(int(.12*sample_rate), int(np.min(np.diff(edges))*.25)))
            left = spectrum(a, min(a+window,b))
            right = spectrum(max(a,b-window),b)
            similarity = float(np.clip(left@right,0,1))
            jump = float(abs(x[b-1]-x[a])/(rms+1e-12))
            seam = float(1/(1+jump))
            score = .5*similarity + .3*stability + .2*seam
            rows.append({'startSeconds':float(beats[i]),'endSeconds':float(beats[j]),'beatCount':count,'startBeatIndex':i,'endBeatIndex':j,'downbeatAligned':i in aligned,'rankingScore':score,'spectralBoundarySimilarity':similarity,'energyStability':stability,'normalizedSampleJump':jump,'rmsDbfs':float(20*np.log10(rms))})
    selected=[]
    for row in sorted(rows,key=lambda v:(-v['rankingScore'],v['startSeconds'],v['beatCount'])):
        if any(other['beatCount']==row['beatCount'] and abs(other['startBeatIndex']-row['startBeatIndex']) < row['beatCount']/2 for other in selected):
            continue
        selected.append(row)
        if len(selected)>=max_loops:
            break
    return {'engine':'Independent-loop-heuristic','version':VERSION,'experimental':True,'durationSeconds':duration,'proposals':selected,'candidatesExamined':len(rows),'settings':{'beatCounts':list(beat_counts),'maxLoops':max_loops,'minRmsDbfs':min_rms_dbfs},'confidence':None,'limitations':['Ranking scores are heuristic, not confidence or musical-quality accuracy.','Endpoints use the supplied independent beat grid; incorrect beats can produce incorrect loops.','Lengths are beats, not assumed 4/4 bars.','Mono boundary screening does not guarantee click-free stereo playback; audition required.','No audio, saved cues, loops or imported analysis are changed.']}
