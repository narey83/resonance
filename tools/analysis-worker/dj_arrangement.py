"""Automatic genre-guided DJ arrangement analysis on independent audio evidence.

Genre weights are routing hints, never probabilities. Model sections are proposals,
not ground truth. No reference annotations or track names enter this module.
"""
from __future__ import annotations
import copy
import math
import subprocess
import time
import hashlib
import numpy as np

REVISION = 'genre-arrangement-v1.1'
ROLES = {'Intro','Outro','Groove','High-energy groove','Breakdown','Buildup','Drop entrance','Sparse break','Transition','Silence'}


def genre_context(genre):
    groups = {'trance': ['trance'], 'rhythmic': ['house','techno','garage','drum & bass','dubstep','hardcore','edm'], 'song': ['pop','rock','hip hop','hip-hop','soul','r&b','jazz']}
    scores = []
    for row in ((genre if isinstance(genre,dict) else {}).get('scores') or []):
        try:
            value = float(row['cosine'])
            if not math.isfinite(value) or not -1<=value<=1: continue
            label = str(row['label']).lower()
            group = next((key for key, labels in groups.items() if any(word in label for word in labels)), 'generic')
            scores.append((value, group, str(row['label'])))
        except (KeyError, TypeError, ValueError): continue
    scores.sort(reverse=True)
    if not scores:
        return {'weights': {'generic': 1.}, 'candidates': [], 'semantics': 'No genre evidence; generic acoustic profile', 'melodicWeight': .35, 'contextBars': 4}
    # Top three close similarities; a clearly stronger class can dominate routing,
    # while unknown/ambiguous tracks remain a blend. These are NOT probabilities.
    best = scores[0][0]
    selected = [s for s in scores[:3] if best-s[0] <= .12]
    raw = [max(.01, .12-(best-s[0])) for s in selected]
    weights = {}
    for (_, group, _), weight in zip(selected, raw): weights[group] = weights.get(group, 0)+weight/sum(raw)
    trance = weights.get('trance', 0)
    return {'weights': weights, 'candidates': [{'label': label, 'similarity': value} for value, _, label in selected],
            'semantics': 'Relative routing weights from text similarities; not calibrated genre confidence',
            'melodicWeight': .35+.15*trance, 'contextBars': 4+round(4*trance)}


def extract_frames(stem_dir, ffmpeg, duration, step_seconds=.1, timeout_seconds=120):
    """Measured RMS, kick-band energy and harmonic/timbre features, in 100 ms frames."""
    if not math.isfinite(duration) or duration <= 0: raise ValueError('Positive finite duration required')
    sample_rate = 8000
    step = round(step_seconds*sample_rate)
    if not 80 <= step <= 8000: raise ValueError('Frame size must be 10 ms to 1 second')
    deadline=time.monotonic()+timeout_seconds
    result = {'stepSeconds': step/sample_rate, 'durationSeconds': duration, 'extractorRevision':REVISION}
    manifest=stem_dir/'manifest.json'
    if manifest.exists():result['stemManifestSha256']=hashlib.sha256(manifest.read_bytes()).hexdigest()
    for stem in ['drums', 'bass', 'other', 'vocals']:
        data = np.frombuffer(subprocess.check_output([str(ffmpeg),'-v','error','-i',str(stem_dir/f'{stem}.wav'),'-ar',str(sample_rate),'-ac','1','-f','f32le','-'],timeout=max(.01,deadline-time.monotonic())),dtype='<f4')
        expected = round(duration*sample_rate)
        if abs(len(data)-expected) > sample_rate*.15: raise ValueError('Stem duration differs from source audio')
        if not len(data) or not np.isfinite(data).all(): raise ValueError('Invalid decoded stem samples')
        count = math.ceil(expected/step)
        padded = np.zeros(count*step,dtype=np.float32);padded[:min(len(data),expected)] = data[:expected]
        frames = padded.reshape(count,step).astype(np.float64)
        # Last-frame RMS accounts for only real samples, not zero padding.
        lengths = np.full(count,step,dtype=float);lengths[-1] = expected-(count-1)*step
        rms = np.sqrt(np.sum(frames**2,axis=1)/lengths)
        result[stem] = rms.tolist()
        if stem in ['drums','other']:
            power = abs(np.fft.rfft(frames*np.hanning(step),axis=1))**2
            frequencies = np.fft.rfftfreq(step,1/sample_rate)
            total = power.sum(axis=1)
            if stem == 'drums':
                low = power[:,(frequencies>=35)&(frequencies<=180)].sum(axis=1)/np.maximum(total,1e-20)
                result['kick'] = (rms*np.sqrt(low)).tolist()
            else:
                result['brightness'] = ((power*frequencies).sum(axis=1)/np.maximum(total,1e-20)/4000).tolist()
                valid = (frequencies>=65)&(frequencies<=2000)
                notes = np.rint(69+12*np.log2(frequencies[valid]/440)).astype(int)%12
                chroma = np.stack([power[:,valid][:,notes==n].sum(axis=1) for n in range(12)],axis=1)
                chroma /= np.maximum(np.linalg.norm(chroma,axis=1,keepdims=True),1e-20)
                result['chroma'] = chroma.tolist()
    return result


def _validate_frames(frames, duration):
    step = float(frames['stepSeconds'])
    if not math.isfinite(step) or step <= 0: raise ValueError('Invalid frame interval')
    arrays = {name: np.asarray(frames[name],dtype=float) for name in ['drums','bass','other','vocals','kick','brightness','chroma']}
    n = len(arrays['drums'])
    if n < 1 or abs(n*step-duration) > step+.15: raise ValueError('Incomplete feature timeline')
    for name, values in arrays.items():
        if len(values)!=n or not np.isfinite(values).all() or (values<0).any(): raise ValueError('Invalid acoustic feature '+name)
        if name=='chroma' and values.shape!=(n,12): raise ValueError('Expected 12 chroma bands')
        if name!='chroma' and values.ndim!=1: raise ValueError('Expected one-dimensional acoustic feature')
    return step, arrays


def _weighted_mean(values, start, end, step, duration):
    # Fractional frame overlaps matter at downbeats; selecting bins by their starts
    # alone can move a boundary by almost a full extraction frame.
    lo=max(0,int(start/step));hi=min(len(values),math.ceil(end/step))
    if hi<=lo: return np.zeros(values.shape[1:]) if values.ndim>1 else 0.
    times=np.arange(lo,hi)*step
    weights=np.maximum(0,np.minimum(np.minimum(times+step,duration),end)-np.maximum(times,start))
    return np.average(values[lo:hi],axis=0,weights=weights) if weights.sum()>0 else np.zeros(values.shape[1:]) if values.ndim>1 else 0.


def analyze_arrangement(profile, musical_segments, frames, duration, downbeats, genre=None):
    if not math.isfinite(duration) or duration<=0: raise ValueError('Positive finite duration required')
    step, arrays = _validate_frames(frames,duration)
    routing = genre_context(genre)
    grid=np.asarray(downbeats or [],dtype=float)
    result=copy.deepcopy(profile)
    if len(grid)<8 or not np.isfinite(grid).all() or (grid<0).any() or (grid>duration).any() or (np.diff(grid)<=0).any():
        # Automatic safe fallback: no fake aligned grid and no invented DJ role.
        result.update(engine='independent-genre-arrangement',revision=REVISION,genreContext=routing,
                      segments=[{'start_seconds':0.,'end_seconds':float(duration),'label':'Transition','labelStatus':'insufficient-evidence','evidence':['Reliable downbeat grid unavailable']}],
                      automatic=True,confidence=None,boundaryDiagnostics={'status':'fallback','reason':'valid downbeat grid required'})
        return result
    median_bar=float(np.median(np.diff(grid)))
    regular=(np.diff(grid)>=median_bar*.6)&(np.diff(grid)<=median_bar*1.4)
    if not .2<=median_bar<=30:
        return analyze_arrangement(profile,musical_segments,frames,duration,[],genre)
    def measure(name,lo,hi): return _weighted_mean(arrays[name],lo,hi,step,duration)
    edges=np.unique(np.r_[0.,grid,duration]);bars=[]
    for lo,hi in zip(edges,edges[1:]):
        row={key:measure(key,lo,hi) for key in arrays}
        row.update(start=float(lo),end=float(hi),regular=bool(.6*median_bar<=hi-lo<=1.4*median_bar))
        bars.append(row)
    active={name:max(float(np.quantile(arrays[name],.75)),1e-5) for name in ['drums','bass','kick','other']}
    def level(name,lo,hi):return float(measure(name,lo,hi))/active[name]
    def change(t,context):
        index=int(np.searchsorted(grid,t))
        lo=float(grid[max(0,index-context)]) if index>0 else 0.
        hi=float(grid[min(len(grid)-1,index+context)]) if index<len(grid)-1 else duration
        rhythm=sum(min(3.,abs(math.log((level(name,t,hi)+.04)/(level(name,lo,t)+.04)))) for name in ['drums','kick','bass'])/3
        a=measure('chroma',lo,t);b=measure('chroma',t,hi);norm=np.linalg.norm(a)*np.linalg.norm(b)
        harmony=float(1-np.dot(a,b)/norm) if norm>1e-8 and level('other',lo,hi)>.1 else 0.
        tone=min(2.,abs(math.log((float(measure('brightness',t,hi))+.02)/(float(measure('brightness',lo,t))+.02))))
        melody=min(2.,abs(math.log((level('other',t,hi)+.04)/(level('other',lo,t)+.04))))
        melodic=(tone+melody+harmony)/3
        weight=routing['melodicWeight']
        return float((1-weight)*rhythm+weight*melodic),{'rhythmChange':float(rhythm),'harmonicChange':harmony,'timbreChange':float(tone),'melodicEnergyChange':float(melody)}
    # Two contexts distinguish persistent arrangement changes from one-bar fills.
    evidence={float(t):(lambda a,b:(.6*a[0]+.4*b[0],a[1]))(change(float(t),2),change(float(t),routing['contextBars'])) for t in grid if 2*median_bar<=t<=duration-2*median_bar}
    def supported(signals):
        # Adding or moving a phrase requires independent rhythm, melodic-energy
        # and timbre/harmony evidence. A drum fill or filter sweep alone is weak.
        rhythmic=signals['rhythmChange']>1. and signals['melodicEnergyChange']>.5 and max(signals['timbreChange'],signals['harmonicChange'])>.2
        melodic=signals['melodicEnergyChange']>(.9-.3*routing['weights'].get('trance',0)) and signals['timbreChange']>.5 and signals['harmonicChange']>.25
        return rhythmic or melodic
    proposals=[];adjustments=[]
    # Existing model boundaries provide broader musical context. A shift requires
    # stronger acoustic support, not merely the next convenient bar line.
    for row in profile.get('segments',[]):
        t=float(row['start_seconds'])
        if not math.isfinite(t): raise ValueError('Nonfinite model boundary')
        if t<0 or t>duration: raise ValueError('Model boundary outside source duration')
        if t<=median_bar or t>=duration-median_bar:continue
        options=[x for x in evidence if abs(x-t)<=median_bar*1.05]
        nearest=min(grid,key=lambda x:abs(x-t))
        chosen=t;why='model-proposal'
        if options:
            original=min(options,key=lambda x:abs(x-t));best=max(options,key=lambda x:evidence[x][0]-.18*abs(x-t)/median_bar)
            if supported(evidence[best][1]) and evidence[best][0]>.7 and evidence[best][0]>evidence[original][0]*1.35+.1:
                chosen=best;why='multichannel-change'
            elif abs(nearest-t)<=min(.5,median_bar*.25): chosen=float(nearest);why='nearby-downbeat'
        proposals.append((chosen,1.0,why))
        if abs(chosen-t)>.001:adjustments.append({'fromSeconds':t,'toSeconds':chosen,'reason':why})
    # Add persistent changes that the musical model omitted. Strong multi-channel
    # evidence is necessary; no obligatory 8/16/32-bar subdivision is introduced.
    scores=np.asarray([v[0] for v in evidence.values()]);threshold=max(.9,float(np.median(scores)+2*np.median(abs(scores-np.median(scores))))) if len(scores) else 1.
    for t,(score,signals) in evidence.items():
        if score<threshold:continue
        neighbours=[x for x in evidence if abs(x-t)<=median_bar*2]
        if t!=max(neighbours,key=lambda x:(evidence[x][0],-x)):continue
        if proposals and min(abs(t-x[0]) for x in proposals) < median_bar*3:continue
        # A change in several channels or an enduring drum withdrawal/return.
        if not supported(signals):continue
        proposals.append((t,score,'persistent-acoustic-change'))
    # Preserve musical-model proposals even when adjacent DJ roles are equal.
    # Different phrases can serve the same role; deleting these loses structure.
    accepted=[]
    for t,priority,why in sorted(proposals,key=lambda x:(-x[1],x[0])):
        if 0<t<duration and all(abs(t-x[0])>=.02 for x in accepted):accepted.append((t,priority,why))
    accepted.sort();points=[0.]+[x[0] for x in accepted]+[float(duration)]
    sections=[]
    for i,(lo,hi) in enumerate(zip(points,points[1:])):
        pulse=level('kick',lo,hi);drums=level('drums',lo,hi);bass=level('bass',lo,hi);other=level('other',lo,hi)
        mid=(lo+hi)/2;head=level('drums',lo,mid);tail=level('drums',mid,hi)
        mh=level('other',lo,mid);mt=level('other',mid,hi)
        bh=float(measure('brightness',lo,mid));bt=float(measure('brightness',mid,hi))
        next_end=min(duration,hi+median_bar*4);next_kick=level('kick',hi,next_end) if hi<duration else pulse;next_bass=level('bass',hi,next_end) if hi<duration else bass
        previous_start=max(0,lo-median_bar*2);previous_kick=level('kick',previous_start,lo) if lo>0 else pulse;previous_bass=level('bass',previous_start,lo) if lo>0 else bass
        silence=max(float(measure(k,lo,hi)) for k in ['drums','bass','other','vocals'])<1e-5
        role='Transition';reasons=[]
        local=[float(b['drums'])/active['drums'] for b in bars if b['start']>=lo-.02 and b['end']<=hi+.02 and b['regular']]
        # Median windows reject a lone crash and tolerate the one-bar pause often
        # placed just before a drop. Compare sustained activity, not the last sample.
        onset=float(np.median(local[:3])) if len(local)>=3 else head
        sustained=max(float(np.median(local[j:j+3])) for j in range(max(0,len(local)-2))) if len(local)>=3 else tail
        base_role=next((s['label'] for s in profile.get('segments',[]) if s['start_seconds']<=(lo+hi)/2<s['end_seconds']),'')
        rise_ratio=1.3 if base_role=='Buildup' else 1.5
        drum_rise=sustained>max(onset*rise_ratio,.15) and onset<.7 and len(local)>=4
        trance_weight=routing['weights'].get('trance',0)
        melody_rise=mt>max(mh*(1.65-.3*trance_weight),.25) and bt>bh*(1.25-.13*trance_weight)
        next_drums=level('drums',hi,next_end) if hi<duration else drums
        approaching_return=next_kick>max(pulse*1.5,.45) and (next_bass>.25 or next_drums>max(drums*1.5,.45))
        if silence:role='Silence';reasons=['All stems below silence floor']
        elif approaching_return and (drum_rise or melody_rise) and hi-lo>=median_bar*3:
            role='Buildup';reasons=['Sustained percussion rise' if drum_rise else 'Melodic energy and brightness rise','Upcoming kick and bass return' if next_bass>.25 else 'Upcoming sustained percussion return']
        elif pulse<.25 and drums<.45:
            role='Breakdown' if other>.1 or bass>.1 else 'Sparse break';reasons=['Sustained kick withdrawal','Melodic or bass material remains' if role=='Breakdown' else 'Sparse accompaniment']
        elif pulse>.55 and bass>.25:
            if lo>0 and previous_kick<.3 and previous_bass<bass*.65:
                role='Drop entrance';reasons=['Kick and bass return after withdrawal']
            else:
                role='High-energy groove' if drums>1.15 and bass>.55 else 'Groove';reasons=['Sustained kick and bass activity']
        elif drums>.35:
            role='Groove';reasons=['Sustained percussion activity']
        else:reasons=['Acoustic cues do not support a specific DJ role']
        # Intro/outro require model context at the edges, not unconditional relabeling.
        midpoint=(lo+hi)/2;musical=next((s.get('label','') for s in musical_segments if s['start_seconds']<=midpoint<s['end_seconds']),'')
        if i==0 and musical in ['intro','start'] and role!='Silence':role='Intro';reasons.append('Opening musical-model context')
        if i==len(points)-2 and musical in ['outro','end'] and role!='Silence':role='Outro';reasons.append('Closing musical-model context')
        sections.append({'start_seconds':lo,'end_seconds':hi,'label':role,'labelStatus':'automatic-evidence-supported' if role!='Transition' else 'insufficient-evidence',
                         'evidence':reasons,'featureEvidence':{'kickLevel':pulse,'drumLevel':drums,'bassLevel':bass,'drumOnset':onset,'drumSustainedPeak':sustained,'nextKick':next_kick,'nextBass':next_bass,'melodyRise':bool(melody_rise)},'boundaryEvidence':evidence.get(lo,(0.,{}))[1],
                         'percussionRms':float(measure('drums',lo,hi)),'bassRms':float(measure('bass',lo,hi))})
    merged=sections
    if sections and all(s['label']=='Silence' for s in sections):
        merged=[dict(sections[0],end_seconds=float(duration))]
    result.update(engine='independent-genre-arrangement',revision=REVISION,segments=merged,automatic=True,experimental=True,confidence=None,genreContext=routing)
    result['boundaryDiagnostics']={'status':'applied','adjustments':adjustments,'addedBoundaries':[t for t,_,why in accepted if why=='persistent-acoustic-change'],
                                   'downbeatRegularFraction':float(regular.mean()),'candidateThreshold':threshold,'semantics':'Acoustic evidence scores, not calibrated accuracy or confidence'}
    result['limitations']=['Automatic independent DJ arrangement predictions; not Rekordbox parity','Genre routing blends similarities and cannot guarantee correct genre','Neutral Transition fallback where evidence is insufficient; no manual setup required']
    return result
