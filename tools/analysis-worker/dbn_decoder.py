"""Offline BeatThis-compatible DBN decoding. No madmom neural weights used."""
import json,sys,types
import numpy as np
# Some source installs omit madmom's separate learned-model submodule. The DSP
# and HMM need no such models; explicitly disable that unused namespace.
sys.modules.setdefault('madmom.models',types.ModuleType('madmom.models'))
from madmom.features.downbeats import DBNDownBeatTrackingProcessor

def decode(beat_logits,downbeat_logits,fps=50):
 b=np.asarray(beat_logits,dtype=float);d=np.asarray(downbeat_logits,dtype=float)
 if b.ndim!=1 or b.shape!=d.shape or len(b)<2 or not np.isfinite(b).all() or not np.isfinite(d).all():raise ValueError('Equal-length nonempty finite frame logit vectors required')
 if fps!=50:raise ValueError('This adapter requires the verified50fps BeatThis grid')
 eps=1e-5;b=(1/(1+np.exp(-np.clip(b,-700,700))))*(1-eps)+eps/2;d=(1/(1+np.exp(-np.clip(d,-700,700))))*(1-eps)+eps/2
 activation=np.stack([np.maximum(b-d,eps/2),d],axis=1)
 proc=DBNDownBeatTrackingProcessor(beats_per_bar=[3,4],min_bpm=55,max_bpm=215,fps=fps,transition_lambda=100)
 grid=proc(activation)
 return {'beats_seconds':grid[:,0].tolist(),'downbeats_seconds':grid[grid[:,1]==1,0].tolist(),'postprocessor':'dbn','dbn':True,'decoder_settings':{'beats_per_bar_candidates':[3,4],'min_bpm':55,'max_bpm':215,'fps':fps,'transition_lambda':100},'decoder_semantics':'BeatThis documented multiclass transform and Madmom HMM/DBN; chooses3or4 meter, imposes tempo continuity. No calibrated confidence or independent accuracy claim; no madmom learned models loaded.'}
if __name__=='__main__':
 p=json.load(sys.stdin);json.dump(decode(p['beat_logits'],p['downbeat_logits'],p.get('frames_per_second',50)),sys.stdout,allow_nan=False)
