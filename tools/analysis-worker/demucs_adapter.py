"""Explicit local HTDemucs inference; no downloads, no source writes."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,time
import numpy as np
import torch
from demucs.pretrained import get_model
from demucs.apply import apply_model

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
p=argparse.ArgumentParser();p.add_argument('audio');p.add_argument('--output',required=True);p.add_argument('--ffmpeg',required=True);p.add_argument('--model-root',required=True);p.add_argument('--seconds',type=float);a=p.parse_args();out=Path(a.output);out.mkdir(parents=True,exist_ok=False);root=Path(a.model_root);weight=root/'955717e8-8726e21a.th';assert sha(weight)=='8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4';torch.set_num_threads(2);torch.manual_seed(0);np.random.seed(0)
cmd=[a.ffmpeg,'-v','error','-i',a.audio];cmd+=['-t',str(a.seconds)] if a.seconds else [];cmd+=['-ac','2','-ar','44100','-f','f32le','-'];audio=np.frombuffer(subprocess.check_output(cmd),dtype='<f4').reshape(-1,2).copy();wave=torch.from_numpy(audio.T);ref=wave.mean(dim=0);mean=ref.mean();std=ref.std();assert std>1e-8;start=time.time();model=get_model('955717e8',repo=root).eval()
with torch.inference_mode():stems=apply_model(model,((wave-mean)/std)[None],device='cpu',shifts=1,split=True,overlap=.25,progress=False)[0]*std+mean
rows={}
for name,stem in zip(model.sources,stems):
 values=stem.cpu().numpy().T.astype('<f4');assert values.shape==audio.shape and np.isfinite(values).all();dest=out/(name+'.wav');subprocess.run([a.ffmpeg,'-v','error','-f','f32le','-ar','44100','-ac','2','-i','-','-c:a','pcm_f32le',str(dest)],input=values.tobytes(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True);rows[name]={'sha256':sha(dest),'frames':len(values),'peak':float(np.max(np.abs(values)))}
manifest={'engine':'htdemucs','checkpointSha256':sha(weight),'audioSha256':sha(a.audio),'sampleRate':44100,'channels':2,'durationSeconds':len(audio)/44100,'stems':rows,'seed':0,'shifts':1,'overlap':.25,'device':'cpu','threads':2,'elapsedSeconds':time.time()-start,'floatWavWithoutIndependentStemRescaling':True,'mixtureRelativeL2Residual':float(torch.linalg.vector_norm(stems.sum(dim=0)-wave)/torch.linalg.vector_norm(wave))};(out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest),flush=True)
