"""Offline singing-voice inference and temporal detection; explicit local weights."""
from pathlib import Path
import math,json,hashlib,argparse,subprocess,importlib.util
from runtime_resources import configure_torch

def detect_scores(scores,duration,on=.9,off=.54,min_seconds=2,gap_seconds=1):
 if not all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in [duration,on,off,min_seconds,gap_seconds]) or not duration>0 or not 0<=off<=on<=1 or not 0<min_seconds<=30 or not 0<=gap_seconds<=10:raise ValueError('Invalid temporal detection settings')
 if len(scores)!=math.ceil(duration) or not all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) and 0<=v<=1 for v in scores):raise ValueError('Complete finite1s score coverage required')
 flags=[];active=False
 for score in scores:active=score>=(off if active else on);flags.append(active)
 i=0
 while i<len(flags):
  j=i+1
  while j<len(flags) and flags[j]==flags[i]:j+=1
  if not flags[i] and i>0 and j<len(flags) and j-i<=gap_seconds:flags[i:j]=[True]*(j-i)
  i=j
 segments=[];i=0
 while i<len(flags):
  j=i+1
  while j<len(flags) and flags[j]==flags[i]:j+=1
  end=min(duration,j)
  if flags[i] and end-i>=min_seconds:segments.append({'startSeconds':float(i),'endSeconds':end,'label':'possible singing voice'})
  elif flags[i]:flags[i:j]=[False]*(j-i)
  i=j
 return {'engine':'CPJKU-zero-mean-singing-voice','experimental':True,'segments':segments,'bins':[{'startSeconds':float(i),'possibleVocals':flag,'singingScore':scores[i]} for i,flag in enumerate(flags)],'windowSeconds':1,'durationSeconds':duration,'settings':{'onScore':on,'offScore':off,'minPresenceSeconds':min_seconds,'maxGapSeconds':gap_seconds},'confidence':None,'limitations':['Externally trained singing detector; uncalibrated score, no speech/rapping coverage guarantee','Small related15-track validation is agreement with saved Rekordbox confidence bins, not independent accuracy','Quiet/effected vocals and synth-like sounds can remain ambiguous']}

def load_model(checkpoint):
 import torch
 here=Path(__file__).resolve().parent;meta=json.loads((here/'optional-singing/provenance.json').read_text());actual=hashlib.sha256(Path(checkpoint).read_bytes()).hexdigest()
 if actual!=meta['checkpointSha256']:raise ValueError('Singing checkpoint identity mismatch')
 spec=importlib.util.spec_from_file_location('resonance_singing_model',here/'optional-singing/model.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);model=module.SingingVoiceDetector(meta['config']).eval();model.load_state_dict(torch.load(checkpoint,map_location='cpu',weights_only=True),strict=True);return model,meta

def predict(model,audio):
 import torch,numpy as np
 if audio.ndim!=1 or not len(audio) or not np.isfinite(audio).all():raise ValueError('Nonempty finite22050Hz mono PCM required')
 with torch.inference_mode():
  spec=torch.stft(torch.from_numpy(audio),1024,hop_length=315,window=torch.hann_window(1024),center=True,pad_mode='reflect',return_complex=True).abs().T
  pad=torch.nn.functional.pad(spec,(0,0,57,57));parts=[]
  for offset in range(0,len(spec),350):
   n=min(350,len(spec)-offset);v=model.probabilities(pad[offset:offset+n+114][None,None])
   if len(v)!=n:raise ValueError('Singing frame alignment mismatch')
   parts.append(v.numpy())
 return np.concatenate(parts)

def main():
 import numpy as np,torch
 p=argparse.ArgumentParser();p.add_argument('audio');p.add_argument('--checkpoint',required=True);p.add_argument('--ffmpeg',required=True);p.add_argument('--output',required=True);p.add_argument('--seconds',type=float);p.add_argument('--on',type=float,default=.9);p.add_argument('--off',type=float,default=.54);a=p.parse_args();dest=Path(a.output)
 if dest.exists():p.error('Choose a new output file')
 threads=configure_torch(torch);model,identity=load_model(a.checkpoint);cmd=[a.ffmpeg,'-v','error','-i',a.audio]+(['-t',str(a.seconds)] if a.seconds else [])+['-ar','22050','-ac','1','-f','f32le','-'];audio=np.frombuffer(subprocess.check_output(cmd),dtype='<f4').copy();frames=predict(model,audio);duration=len(audio)/22050;scores=[float(np.mean(frames[math.ceil(i*70):min(len(frames),math.ceil(min(i+1,duration)*70))])) for i in range(math.ceil(duration))];result=detect_scores(scores,duration,a.on,a.off);result.update(identity=identity,threads=threads,frameRate=70,frameScores=frames.tolist(),frameSemantics='Centered1024sample STFT,315sample hop,114frame context; retained frame scores uncalibrated',scriptSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest());dest.write_text(json.dumps(result,allow_nan=False))
if __name__=='__main__':main()
