"""Local CLAP embeddings. Explicit cached general-model snapshot; no downloads.

Independent512Dspace; never mix with Rekordbox64Dvectors. Pooling is a new
Resonance design: L2normalize each10swindow, mean, L2normalize the result.
Text cosines are uncalibrated similarity scores, not genre confidence.
"""
import os
os.environ.setdefault('HF_HUB_OFFLINE','1')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY','1')
os.environ.setdefault('TOKENIZERS_PARALLELISM','false')
from pathlib import Path
import hashlib,json
import numpy as np

def file_sha256(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()

def feature_tensor(value):
 import torch
 if torch.is_tensor(value):return value
 if getattr(value,'pooler_output',None) is not None:return value.pooler_output
 raise TypeError('UnexpectedCLAPfeatureoutput')

class EmbeddingEngine:
 def __init__(self,snapshot,threads=2):
  import torch,importlib.metadata
  from transformers import ClapModel,ClapProcessor
  self.snapshot=Path(snapshot).resolve(strict=True)
  # Caller supplieslocalfiles: local_files_onlypreventsmodel/tokenizerdownloads.
  torch.set_num_threads(threads)
  self.model,info=ClapModel.from_pretrained(str(self.snapshot),local_files_only=True,output_loading_info=True)
  if any(info.get(k) for k in ('missing_keys','unexpected_keys','mismatched_keys','error_msgs')):raise ValueError(f'Checkpointloadingmismatch:{info}')
  self.model=self.model.to('cpu').eval();self.processor=ClapProcessor.from_pretrained(str(self.snapshot),local_files_only=True)
  if self.processor.feature_extractor.sampling_rate!=48000:raise ValueError('Expected48kHzCLAPsnapshot')
  weights=self.snapshot/'pytorch_model.bin'
  if not weights.is_file():raise ValueError('Thisadapteridentityexpectsverifiedpytorch_model.bin')
  self.identity={'engine':'CLAP','model_repo':'laion/larger_clap_general','revision':self.snapshot.name,'checkpoint_sha256':file_sha256(weights),'config_sha256':file_sha256(self.snapshot/'config.json'),'transformers':importlib.metadata.version('transformers'),'dimension':512,'device':'cpu','threads':threads}
  sanity=self.text_features(['A dog is barking.','Rain is falling.','A piano is playing.','A crowd is cheering.']);pair=sanity@sanity.T
  if np.min(pair[~np.eye(4,dtype=bool)])>.99:raise ValueError('Collapsedtextembeddingguardfailed; checkpointnotapproved')
 def text_features(self,prompts):
  import torch
  with torch.inference_mode():v=feature_tensor(self.model.get_text_features(**self.processor.tokenizer(prompts,padding=True,return_tensors='pt')));v=torch.nn.functional.normalize(v,dim=-1)
  return v.cpu().numpy()
 def analyze(self,mono48k,prompts=None,genre_prompt_profile=None):
  import torch
  audio=np.asarray(mono48k,dtype=np.float32)
  if audio.ndim!=1 or not len(audio) or not np.isfinite(audio).all():raise ValueError('Expectednonemptyfinite48kHzmonoPCM')
  vectors=[];windows=[]
  for start in range(0,len(audio),480000):
   segment=audio[start:start+480000];inputs=self.processor.feature_extractor(segment,sampling_rate=48000,return_tensors='pt')
   with torch.inference_mode():v=feature_tensor(self.model.get_audio_features(**inputs));v=torch.nn.functional.normalize(v,dim=-1)
   a=v[0].cpu().numpy()
   if a.shape!=(512,) or not np.isfinite(a).all():raise ValueError('InvalidCLAPembedding')
   vectors.append(a);windows.append({'start_seconds':start/48000,'duration_seconds':len(segment)/48000,'embedding':a.tolist()})
  pooled=np.mean(vectors,axis=0);norm=np.linalg.norm(pooled)
  if norm<=1e-10:raise ValueError('Degeneratepooledembedding')
  pooled/=norm
  result={'identity':self.identity,'duration_seconds':len(audio)/48000,'pooling':'EquallyweightedmeanofL2normalizednonoverlapping10secondwindows,thenL2normalize;lastshortwindowequallyweighted','embedding':pooled.tolist(),'windows':windows,'confidence':None,'limitations':['Independentmodelspace; notRekordbox64Dcompatible','Poolingnewdesignnotvalidatedagainstsemanticgroundtruth','Promptcosinesarenotcalibratedgenreconfidence']}
  if prompts:
   text=self.text_features(prompts);scores=pooled@text.T;result['text_cosines']=[{'prompt':p,'cosine':float(s)} for p,s in zip(prompts,scores)]
  if genre_prompt_profile and prompts:
   from genre_profiles import prompts as genre_prompts
   families=[p.removeprefix('This is a ').removesuffix(' music track.') for p in prompts]
   prototypes=[];descriptions=[]
   for label in families:
    captions=genre_prompts(label,genre_prompt_profile);v=self.text_features(captions).mean(axis=0);norm=np.linalg.norm(v)
    if norm<=1e-10:raise ValueError('Degenerate genre prototype')
    prototypes.append(v/norm);descriptions.append(captions)
   scores=np.asarray(prototypes)@pooled
   result['genre_text_cosines']=[{'label':label,'prompt':f'This is a {label} music track.','prompts':captions,'cosine':float(score)} for label,captions,score in zip(families,descriptions,scores)]
   result['genre_prompt_profile']=genre_prompt_profile
  return result
