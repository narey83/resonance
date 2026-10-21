"""Local-only Spleeter4stems adapter. Published Spleeter source/models: MIT.

Explicit model cache and ffmpeg required. Does not download missing checkpoints.
Mac test uses TF-macos2.12.0; official Linux deployment pins need separate testing.
"""
from pathlib import Path
import argparse, hashlib, json, os, subprocess, time

def digest(p):
    h=hashlib.sha256()
    with Path(p).open('rb') as f:
        for b in iter(lambda:f.read(1048576),b''):h.update(b)
    return h.hexdigest()

def separate(track, model_root, output, ffmpeg, seconds=None):
    track=Path(track).resolve(strict=True);model_root=Path(model_root).resolve(strict=True)
    model=model_root/'4stems'; required=['checkpoint','model.index','model.meta','model.data-00000-of-00001']
    if not all((model/n).is_file() for n in required):raise ValueError('A complete explicit local4stems checkpoint is required')
    out=Path(output);out.mkdir(parents=True,exist_ok=False)
    os.environ['MODEL_PATH']=str(model_root)
    os.environ.setdefault('TF_NUM_INTRAOP_THREADS','2');os.environ.setdefault('TF_NUM_INTEROP_THREADS','1')
    import numpy as np
    from spleeter.model.provider import ModelProvider
    if Path(ModelProvider.DEFAULT_MODEL_PATH).resolve()!=model_root:
        raise RuntimeError("Spleeter was already initialized with a different model cache; use an isolated worker process")
    from spleeter.separator import Separator
    cmd=[ffmpeg,'-v','error','-i',str(track)]
    if seconds is not None:
        if not 0<seconds<86400:raise ValueError('seconds must be positive and bounded')
        cmd+=['-t',str(seconds)]
    cmd+=['-ac','2','-ar','44100','-f','f32le','pipe:1']
    raw=subprocess.run(cmd,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout
    audio=np.frombuffer(raw,dtype='<f4').reshape(-1,2)
    started=time.monotonic();stems=Separator('spleeter:4stems',multiprocess=False).separate(audio)
    if set(stems)!={'vocals','drums','bass','other'}:raise ValueError('Unexpected stem set')
    rows={}
    for name,values in stems.items():
        values=np.asarray(values,dtype='<f4')
        if values.shape!=audio.shape or not np.isfinite(values).all():raise ValueError('Invalid stem '+name)
        dest=out/(name+'.wav')
        # Float WAV retains peaks above1.0 without clipping or integer quantization.
        subprocess.run([ffmpeg,'-v','error','-f','f32le','-ar','44100','-ac','2','-i','pipe:0','-c:a','pcm_f32le',str(dest)],input=values.tobytes(),check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        rows[name]={'file':dest.name,'sha256':digest(dest),'frames':len(values),'peak':float(abs(values).max()),'rms':float(np.sqrt(np.mean(values.astype(np.float64)**2)))}
    residual=float(np.linalg.norm(sum(v.astype(np.float64) for v in stems.values())-audio)/max(np.linalg.norm(audio.astype(np.float64)),np.finfo(float).tiny))
    manifest={'schemaVersion':1,'engine':'spleeter:4stems','sourceSha256':digest(track),'sampleRate':44100,'channels':2,'encoding':'float32 WAV','inferenceSeconds':time.monotonic()-started,'stems':rows,'mixtureRelativeL2Residual':residual,'checkpointFiles':{n:digest(model/n) for n in required},'limitations':['Independent separator; no exact Rekordbox parity or quality score implied','Mixture residual measures reconstruction consistency, not source separation accuracy']}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('track');p.add_argument('--model-root',required=True);p.add_argument('--output',required=True);p.add_argument('--ffmpeg',required=True);p.add_argument('--seconds',type=float);a=p.parse_args()
    print(json.dumps(separate(a.track,a.model_root,a.output,a.ffmpeg,a.seconds)))
