"""Offline two-model score consensus on an aligned50fps grid; no learned weights."""
import sys,types,json,argparse
from pathlib import Path
import numpy as np
sys.modules.setdefault('madmom.models',types.ModuleType('madmom.models'))
from madmom.features.downbeats import DBNDownBeatTrackingProcessor

def decode(beatthis,allinone,weight=.75):
 if not isinstance(weight,(int,float)) or not 0<=weight<=1:raise ValueError('Consensus weight must be0..1')
 sigmoid=lambda x:1/(1+np.exp(-np.clip(np.asarray(x),-80,80)))
 ab=sigmoid(allinone['logits_beat'][0][::2]);ad=sigmoid(allinone['logits_downbeat'][0][::2]);bb=sigmoid(beatthis['beat_logits']);bd=sigmoid(beatthis['downbeat_logits'])
 if beatthis.get('frames_per_second',50)!=50 or len(bb)!=len(bd) or len(ab)!=len(ad) or abs(len(ab)-len(bb))>2 or not all(np.isfinite(v).all() for v in [ab,ad,bb,bd]):raise ValueError('Finite aligned50/100fps activation grids required')
 n=min(len(ab),len(bb));beat=((1-weight)*bb[:n]+weight*ab[:n])*(1-1e-5)+.5e-5;down=((1-weight)*bd[:n]+weight*ad[:n])*(1-1e-5)+.5e-5;act=np.stack([np.maximum(beat-down,.5e-5),down],axis=1);grid=DBNDownBeatTrackingProcessor(beats_per_bar=[3,4],min_bpm=55,max_bpm=215,fps=50,transition_lambda=100)(act)
 return {'beats_seconds':grid[:,0].tolist(),'downbeats_seconds':grid[grid[:,1]==1,0].tolist(),'postprocessor':'two-model-consensus-dbn','engine':'BeatThis+AllInOne-score-consensus','dbn':True,'consensusWeightAllInOne':weight,'decoder_settings':{'beats_per_bar_candidates':[3,4],'min_bpm':55,'max_bpm':215,'fps':50,'transition_lambda':100},'consensusFrameAlignment':{'beatThisFps':50,'allInOneFps':100,'resampling':'AllInOne everysecondframe fromtime0; no reference-fitted offset','framesUsed':n,'beatThisFrames':len(bb),'allInOneResampledFrames':len(ab)},'decoder_semantics':'Fixed weighted sigmoid-score average followed by documented BeatThis transform and DBN; uncalibrated model scores, not confidence; no Madmom learned models.'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--beatthis',required=True);p.add_argument('--allinone',required=True);p.add_argument('--weight',type=float,default=.75);p.add_argument('--output',required=True);a=p.parse_args();dest=Path(a.output)
 if dest.exists():p.error('Choose new output path')
 dest.write_text(json.dumps(decode(json.loads(Path(a.beatthis).read_text()),np.load(a.allinone),a.weight),allow_nan=False))
