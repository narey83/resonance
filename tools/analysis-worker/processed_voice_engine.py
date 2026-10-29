"""Explicit local Silero TorchScript inference; no model download."""
from pathlib import Path
import argparse,hashlib,json,math,subprocess
from secondary_profiles import processed_voice
from runtime_resources import configure_torch

def main():
 import torch,numpy as np
 p=argparse.ArgumentParser();p.add_argument('audio');p.add_argument('--checkpoint',required=True);p.add_argument('--sha256',required=True);p.add_argument('--ffmpeg',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 weight=Path(a.checkpoint);actual=hashlib.sha256(weight.read_bytes()).hexdigest()
 if actual!=a.sha256:raise ValueError('Speech checkpoint identity mismatch')
 dest=Path(a.output)
 if dest.exists():raise ValueError('Choose a new output')
 threads=configure_torch(torch);model=torch.jit.load(str(weight),map_location='cpu').eval();model.reset_states();audio=np.frombuffer(subprocess.check_output([a.ffmpeg,'-v','error','-i',a.audio,'-ar','16000','-ac','1','-f','f32le','-']),dtype='<f4').copy();frames=[]
 with torch.inference_mode():
  for offset in range(0,len(audio),512):
   chunk=audio[offset:offset+512];chunk=np.pad(chunk,(0,512-len(chunk)));frames.append(float(model(torch.from_numpy(chunk),16000)))
 duration=len(audio)/16000;scores=[]
 for second in range(math.ceil(duration)):
  lo=int(second/.032);hi=min(len(frames),math.ceil(min(second+1,duration)/.032));offsets=np.arange(lo,hi)*.032;weights=np.maximum(0,np.minimum(offsets+.032,min(second+1,duration))-np.maximum(offsets,second));scores.append(float(np.average(frames[lo:hi],weights=weights)))
 result=processed_voice(scores,duration,{'checkpointSha256':actual,'source':'https://github.com/snakers4/silero-vad','license':'MIT'});result['threads']=threads;dest.write_text(json.dumps(result,allow_nan=False))
if __name__=='__main__':main()
