"""Offline author8fold logit ensemble using verified vectorized attention."""
from pathlib import Path
import argparse,json,hashlib,subprocess,sys,types,time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np,torch
from torch_attention import qk,av
from runtime_resources import configure_torch
# Dedicated process: expose the verified mathematical operators to the unchanged
# author model source, avoiding a native NATTEN dependency at runtime.
package=types.ModuleType('natten');package.__path__=[];functions=types.ModuleType('natten.functional')
functions.natten1dqkrpb=functions.natten2dqkrpb=qk;functions.natten1dav=functions.natten2dav=av
sys.modules['natten']=package;sys.modules['natten.functional']=functions
from functional_adapter import spectrogram,load_author_model,functional_segments,LABELS

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--source-root',required=True);p.add_argument('--checkpoint',required=True);p.add_argument('--ensemble-manifest',required=True);p.add_argument('--stems-dir',required=True);p.add_argument('--ffmpeg',required=True);p.add_argument('--output',required=True);a=p.parse_args();dest=Path(a.output)
 if dest.exists():p.error('Choose new output path')
 start=time.time();threads=configure_torch(torch);manifest_path=Path(a.ensemble_manifest);manifest=json.loads(manifest_path.read_text());rows=manifest['files']
 if len(rows)!=8 or len({r['file'] for r in rows})!=8:raise ValueError('Explicit8distinctfold checkpoints required')
 specs=[];hashes={}
 for name in ['bass','drums','other','vocals']:
  wav=Path(a.stems_dir)/(name+'.wav');hashes[name]=sha(wav);raw=subprocess.check_output([a.ffmpeg,'-v','error','-i',str(wav),'-ac','1','-ar','44100','-f','f32le','-']);specs.append(spectrogram(np.frombuffer(raw,dtype='<f4')))
 tensor=torch.from_numpy(np.stack(specs)).unsqueeze(0);keys=['logits_beat','logits_downbeat','logits_section','logits_function'];outputs=[];configs=[]
 for row in rows:
  weight=manifest_path.parent/row['file']
  if sha(weight)!=row['sha256']:raise ValueError('Ensemble checkpoint identity mismatch')
  model,cfg=load_author_model(a.source_root,weight)
  if cfg.fps!=100 or cfg.sample_rate!=44100 or cfg.hop_size!=441 or cfg.data.num_labels!=10:raise ValueError('Unverified ensemble frontend/config')
  with torch.inference_mode():out=model(tensor)
  outputs.append({k:getattr(out,k).numpy() for k in keys});configs.append(cfg);del model,out
 from allin1.typings import AllInOneOutput
 values={k:np.mean([out[k] for out in outputs],axis=0) for k in keys};average=AllInOneOutput(**{k:torch.from_numpy(v) for k,v in values.items()});segments=functional_segments(average,configs[0]);posteriors=torch.softmax(average.logits_function[0],dim=0).numpy()
 for segment in segments:
  lo=round(segment['start_seconds']*100);hi=round(segment['end_seconds']*100);scores=posteriors[:,lo:hi].mean(axis=1);rank=np.argsort(-scores);segment['label_status']='experimental-eight-fold-model-prediction';segment['labelScores']=[{'label':LABELS[i],'score':float(scores[i])} for i in rank[:3]];segment['labelMargin']=float(scores[rank[0]]-scores[rank[1]])
 activations=dest.with_suffix('.npz');np.savez_compressed(activations,**values);report={'status':'success','engine':'AllInOne-eight-fold-logit-ensemble','segments':segments,'input_shape':list(tensor.shape[1:]),'stem_sha256':hashes,'checkpoints':rows,'source_files_sha256':{str(f.relative_to(a.source_root)):sha(f) for f in (Path(a.source_root)/'src/allin1').rglob('*.py')},'torch_version':torch.__version__,'numpy_version':np.__version__,'threads':threads,'model_config':dict(configs[0]),'attentionSha256':sha(Path(__file__).with_name('torch_attention.py')),'adapter_sha256':sha(__file__),'activationsArtifact':activations.name,'activationsSha256':sha(activations),'elapsed_seconds':time.time()-start,'confidence':None,'limitations':['Uncalibrated model label scores/margins, not confidence','HTDemucs float stems; author CLI encoding/rescaling differences remain','Native versus vectorized attention parity checked on varied tensors and fullHarryPopper; no independent music-label accuracy claim'],'sources':['https://github.com/mir-aidj/all-in-one','https://huggingface.co/taejunkim/allinone']};dest.write_text(json.dumps(report,indent=2,default=str,allow_nan=False))
if __name__=='__main__':main()
