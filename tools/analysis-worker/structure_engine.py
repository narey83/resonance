"""Original experimental structure/cue heuristics. No trained/vendor models.

Sections are change candidates, not semantic verse/chorus classifications.
Supplied beat timestamps are external input: this worker does not estimate tempo.
NumPy only; CLI invokes caller-provided FFmpeg for local audio decoding.
"""
from pathlib import Path
import argparse,hashlib,json,subprocess,numbers
import numpy as np
VERSION='0.1-experimental'

def frame_features(audio,sample_rate):
    x=np.asarray(audio,dtype=np.float64).reshape(-1)
    if not np.isfinite(x).all():raise ValueError('Audio contains nonfinite samples')
    size=2048;hop=512
    if len(x)<size:x=np.pad(x,(0,size-len(x)))
    frames=np.lib.stride_tricks.sliding_window_view(x,size)[::hop]
    # Process bounded batches to avoid full-song temporary FFT materialization.
    frequencies=np.fft.rfftfreq(size,1/sample_rate)
    valid=frequencies>=55
    pitch=np.zeros_like(frequencies,dtype=int)
    pitch[valid]=np.rint(69+12*np.log2(frequencies[valid]/440)).astype(int)%12
    rows=[];previous=None
    window=np.hanning(size)
    for start in range(0,len(frames),512):
        block=frames[start:start+512];spec=np.abs(np.fft.rfft(block*window,axis=1))
        total=spec.sum(axis=1)+1e-12
        centroid=(spec@frequencies)/total/(sample_rate/2)
        energy=np.log10(np.sqrt(np.mean(block**2,axis=1))+1e-8)
        chroma=np.column_stack([spec[:,valid&(pitch==c)].sum(axis=1) for c in range(12)])
        chroma/=np.linalg.norm(chroma,axis=1,keepdims=True)+1e-12
        normalized=spec/total[:,None]
        prior=np.vstack([previous if previous is not None else normalized[0],normalized[:-1]])
        flux=np.maximum(normalized-prior,0).sum(axis=1)
        previous=normalized[-1]
        rows.append(np.c_[energy,centroid,chroma,flux])
    return (np.arange(len(frames))*hop+size/2)/sample_rate,np.vstack(rows)

def analyze_structure(audio,sample_rate,beats_seconds,context_beats=4,min_spacing_beats=16,max_cues=8):
    if isinstance(sample_rate,(bool,np.bool_)) or not isinstance(sample_rate,numbers.Real) or not np.isfinite(sample_rate) or sample_rate<=0:
        raise ValueError('Finite positive sample rate required')
    x=np.asarray(audio)
    if x.ndim!=1:raise ValueError('Mono one-dimensional audio required')
    if not len(x) or not np.isfinite(x).all():raise ValueError('Nonempty finite audio required')
    for name,value in [('context_beats',context_beats),('min_spacing_beats',min_spacing_beats),('max_cues',max_cues)]:
        if isinstance(value,(bool,np.bool_)) or not isinstance(value,(int,np.integer)) or value<1:
            raise ValueError(name+' must be a positive integer')
    duration=len(x)/sample_rate
    beats=np.asarray(beats_seconds,dtype=float)
    if sample_rate<=0 or duration<=0:raise ValueError('Positive rate and nonempty audio required')
    if beats.ndim!=1 or len(beats)<2 or not np.isfinite(beats).all() or np.any(np.diff(beats)<=0) or beats[0]<0:
        raise ValueError('Explicit nonnegative strictly increasing beat timestamps required')
    beats=beats[beats<duration]
    if len(beats)<2:raise ValueError('Need at least two in-range beats')
    if context_beats<1 or min_spacing_beats<1 or max_cues<1:raise ValueError('Positive settings required')
    times,features=frame_features(x,sample_rate)
    # Average audio features over beat intervals; sparse intervals use nearestframe.
    end=np.r_[beats[1:],duration];aggregated=[]
    for a,b in zip(beats,end):
        index=np.flatnonzero((times>=a)&(times<b))
        if not len(index):index=np.array([int(np.argmin(abs(times-(a+b)/2)))])
        aggregated.append(features[index].mean(axis=0))
    aggregated=np.asarray(aggregated);novelty=np.zeros(len(beats));components={}
    c=context_beats
    for i in range(c,len(beats)-c):
        left=aggregated[i-c:i].mean(axis=0);right=aggregated[i:i+c].mean(axis=0)
        energy=abs(right[0]-left[0])
        centroid=abs(right[1]-left[1])
        chroma_norm=np.linalg.norm(left[2:14])*np.linalg.norm(right[2:14])
        chroma=0. if chroma_norm<1e-10 else 1-float(np.dot(left[2:14],right[2:14])/chroma_norm)
        # Original transparent weighting; not probabilities or learnedconfidence.
        score=.5*energy+2*centroid+max(0,chroma)
        novelty[i]=score;components[i]={'log10_rms_change':float(energy),'normalized_centroid_change':float(centroid),'chroma_cosine_distance':float(max(0,chroma))}
    interior=novelty[c:len(beats)-c]
    median=float(np.median(interior)) if len(interior) else 0
    mad=float(np.median(abs(interior-median))) if len(interior) else 0
    threshold=max(.12,median+3*mad)
    # Localmaxima then greedyspacing. Earliestindex resolves a flat maximum.
    peaks=[]
    for i in range(c,len(beats)-c):
        lo=max(c,i-c);hi=min(len(beats)-c,i+c+1)
        if novelty[i]>=threshold and i==lo+int(np.argmax(novelty[lo:hi])):peaks.append(i)
    selected=[]
    for i in sorted(peaks,key=lambda i:(-novelty[i],i)):
        if all(abs(i-j)>=min_spacing_beats for j in selected):selected.append(i)
    selected.sort()
    sections=[];starts=[0.]+[float(beats[i]) for i in selected]
    for n,(a,b) in enumerate(zip(starts,starts[1:]+[duration]),1):
        sections.append({'label':f'Section {n}','start_seconds':a,'end_seconds':b,'semantic_type':None})
    # Firstbeat cue plus strongest section changes; chronological output.
    cues=[{'seconds':float(beats[0]),'beat_index':0,'reason':'First supplied beat','novelty_score':None}]
    for i in sorted(selected,key=lambda i:(-novelty[i],i))[:max_cues-1]:
        cues.append({'seconds':float(beats[i]),'beat_index':int(i),'reason':'Section change candidate','novelty_score':float(novelty[i]),'components':components[i]})
    cues.sort(key=lambda c:c['seconds'])
    return {'engine':'original-spectral-change-heuristic','version':VERSION,'experimental':True,'duration_seconds':duration,'beat_grid_source':'Caller supplied; beat/tempo estimation not performed','settings':{'sample_rate':sample_rate,'fft_size':2048,'hop_samples':512,'context_beats_each_side':context_beats,'min_boundary_spacing_beats':min_spacing_beats,'max_cues':max_cues,'threshold':threshold,'threshold_rule':'max(0.12, median novelty +3*MAD)','score_formula':'0.5*abs(log10RMSchange)+2*abs(normalizedcentroidchange)+chromaCosineDistance'},'sections':sections,'boundary_candidates':[{'seconds':float(beats[i]),'beat_index':int(i),'novelty_score':float(novelty[i]),'components':components[i]} for i in selected],'cue_proposals':cues,'limitations':['Heuristic novelty is not confidence or probability','Sectionlabels are sequential; verse/chorus/drop semantics are not inferred','Repeating or gradual changes may be missed; localtransients may produce false boundaries','Suppliedbeatgriderrors affect alignment andspacing','No personalhistory, trainedweights, vendorassets, or Rekordboxparity claimed']}

def main():
    p=argparse.ArgumentParser();p.add_argument('audio');p.add_argument('--beats',required=True,help='JSON array of seconds, or object with beats_seconds');p.add_argument('--ffmpeg',required=True);p.add_argument('--seconds',type=float);p.add_argument('--output',required=True);a=p.parse_args()
    if a.seconds is not None and (not np.isfinite(a.seconds) or a.seconds<=0):p.error('--seconds must be finite and positive')
    if Path(a.output).exists():p.error('--output already exists; choose a new path to preserve results')
    data=json.loads(Path(a.beats).read_text());beats=data['beats_seconds'] if isinstance(data,dict) else data
    cmd=[a.ffmpeg,'-v','error','-i',a.audio]
    if a.seconds:cmd+=['-t',str(a.seconds)]
    cmd+=['-ac','1','-ar','22050','-f','f32le','-']
    raw=subprocess.run(cmd,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120).stdout
    report=analyze_structure(np.frombuffer(raw,dtype='<f4'),22050,beats)
    report['provenance']={'source_audio_sha256':hashlib.sha256(Path(a.audio).read_bytes()).hexdigest(),'beats_file_sha256':hashlib.sha256(Path(a.beats).read_bytes()).hexdigest(),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'numpy_version':np.__version__,'model_weights':None,'audio_uploaded':False}
    Path(a.output).parent.mkdir(parents=True,exist_ok=True)
    with Path(a.output).open('x') as f:f.write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'sections':len(report['sections']),'cues':len(report['cue_proposals']),'output':a.output}))
if __name__=='__main__':main()
