"""Frozen-heuristic agreement comparison; reference boundaries are candidates.
No tuning, no semantic label comparison, no music uploads.
"""
from pathlib import Path
import hashlib,json,subprocess,time,csv,functools,argparse,urllib.parse
import numpy as np
from structure_engine import analyze_structure
ROOT=Path(__file__).resolve().parents[3]

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def match_boundaries(predicted,reference,tolerance=2.):
    a=sorted(predicted);b=sorted(reference)
    # Maximize one-to-one matchedcount, then minimize summedabsoluteoffset.
    @functools.lru_cache(None)
    def solve(i,j):
        if i==len(a) or j==len(b):return (0,0.,())
        choices=[solve(i+1,j),solve(i,j+1)]
        if abs(a[i]-b[j])<=tolerance:
            count,error,pairs=solve(i+1,j+1);choices.append((count+1,error+abs(a[i]-b[j]),((a[i],b[j]),)+pairs))
        return min(choices,key=lambda x:(-x[0],x[1]))
    count,error,pairs=solve(0,0)
    return {'matched':count,'predicted_count':len(a),'reference_candidate_count':len(b),'precision_agreement':count/len(a) if a else None,'recall_agreement':count/len(b) if b else None,'f1_agreement':2*count/(len(a)+len(b)) if len(a)+len(b) else None,'mean_matched_offset_seconds':error/count if count else None,'pairs':[{'predicted':x,'reference_candidate':y,'absolute_offset_seconds':abs(x-y)} for x,y in pairs]}

def main():
    p=argparse.ArgumentParser();p.add_argument('--ffmpeg',required=True);p.add_argument('--output-dir',required=True);p.add_argument('--sample-rate',type=int,default=22050);a=p.parse_args()
    if a.sample_rate<=0:p.error('--sample-rate must be positive')
    out=Path(a.output_dir);out.mkdir(parents=True,exist_ok=False)
    grids=ROOT/'outputs/rekordbox-migration/beat-this-full-validation.json'
    griddata=json.loads(grids.read_text());baseline=json.loads((ROOT/'outputs/rekordbox-baseline/results.json').read_text());tracks={t['TrackID']:t for t in baseline}
    engine=Path(__file__).with_name('structure_engine.py');frozen_hash=sha(engine)
    summary={'status':'running','comparison':'Independent heuristic boundary agreement against decoded Rekordbox candidate boundary timestamps; neither semanticaccuracy nor groundtruth','tolerance_seconds':2.,'matching':'One-to-one monotonic dynamicprogram, maximummatchcount thenminimumabsoluteoffset','heuristics_frozen_sha256':frozen_hash,'independent_grid_sha256':sha(grids),'model_weights_in_structure_engine':None,'analysis_sample_rate':a.sample_rate,'numpy_version':np.__version__,'tracks':[]}
    start=time.perf_counter()
    for t in griddata['tracks']:
        ident=t['TrackID'];source=tracks[ident]
        audio=Path(urllib.parse.unquote(urllib.parse.urlparse(source['Location']).path))
        reference=ROOT/'outputs/rekordbox-migration/collection-final'/f'{ident}.json'
        ref=json.loads(reference.read_text());expected=[e['startSecondsCandidate'] for e in ref['phrases']['entries'][1:] if e.get('startSecondsCandidate') is not None]
        ts=time.perf_counter()
        cmd=[a.ffmpeg,'-v','error','-i',str(audio),'-ac','1','-ar',str(a.sample_rate),'-f','f32le','-']
        pcm=subprocess.run(cmd,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120).stdout
        decoded=time.perf_counter();result=analyze_structure(np.frombuffer(pcm,dtype='<f4'),a.sample_rate,t['beats_seconds']);finished=time.perf_counter()
        agreement=match_boundaries([v['seconds'] for v in result['boundary_candidates']],expected)
        result['provenance']={'audio_sha256':sha(audio),'audio_path':str(audio),'independent_grid_track_audio_sha256':t['audio_sha256'],'grid_file_sha256':sha(grids),'reference_candidates_sha256':sha(reference),'engine_sha256':frozen_hash,'decode_seconds':decoded-ts,'analysis_seconds':finished-decoded,'audio_uploaded':False}
        if result['provenance']['audio_sha256']!=t['audio_sha256']:raise ValueError('Audioidentity mismatch '+ident)
        result['candidate_boundary_agreement']=agreement
        with (out/f'{ident}.json').open('x') as f:json.dump(result,f,indent=2)
        summary['tracks'].append({'track_id':ident,'title':t['name'],'duration_seconds':result['duration_seconds'],'analysis_seconds':finished-decoded,'decode_seconds':decoded-ts,'section_count':len(result['sections']),'cue_count':len(result['cue_proposals']),**{k:v for k,v in agreement.items() if k!='pairs'}})
    if sha(engine)!=frozen_hash:raise RuntimeError('Structureheuristics changed duringbenchmark')
    totals={k:sum(t[k] for t in summary['tracks']) for k in ['matched','predicted_count','reference_candidate_count']}
    summary.update(status='complete',elapsed_seconds=time.perf_counter()-start,tracks_analyzed=len(summary['tracks']),totals=totals)
    summary['micro_agreement']={'precision':totals['matched']/totals['predicted_count'] if totals['predicted_count'] else None,'recall':totals['matched']/totals['reference_candidate_count'] if totals['reference_candidate_count'] else None,'f1':2*totals['matched']/(totals['predicted_count']+totals['reference_candidate_count']) if totals['predicted_count']+totals['reference_candidate_count'] else None}
    summary['limitations']=['Reference entries andtimestamps are decodedcandidates with unresolved boundaryinclusivity; nothumanannotations','Agreement doesnot validate verse/chorus/drop labels; workerusessequentialSectionNlabels','Corpus14tracks isnotrepresentativegeneralization test','Bothindependentbeatgrid errors andboundaryheuristics cancontributetodifferences','Defaultsunchanged; no thresholds tunedtoRekordbox']
    summary['benchmark_script_sha256']=sha(__file__)
    with (out/'summary.json').open('x') as f:json.dump(summary,f,indent=2)
    with (out/'summary.csv').open('x',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(summary['tracks'][0]));writer.writeheader();writer.writerows(summary['tracks'])
    print(json.dumps({'tracks':summary['tracks_analyzed'],'micro_agreement':summary['micro_agreement'],'totals':totals,'elapsed_seconds':summary['elapsed_seconds'],'output':str(out)}))
if __name__=='__main__':main()
