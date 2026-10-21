"""Compare experimentaldecoder with frozen author functionalpostprocessing.
No modelweights, source separation, madmom, NATTEN, or network required.
"""
from pathlib import Path
import sys,types,json
import numpy as np
import torch
from functional_adapter import functional_segments
source=Path(__file__).resolve().parent/'author-source/src/allin1'
for name,path in [('allin1',source),('allin1.postprocessing',source/'postprocessing')]:
    m=types.ModuleType(name);m.__path__=[str(path)];sys.modules[name]=m
from allin1.postprocessing.functional import postprocess_functional_structure
from types import SimpleNamespace
cfg=SimpleNamespace(min_hops_per_beat=24,fps=100,hop_size=441,sample_rate=44100)
# Distinct peaks avoidthreshold/tieambiguities; 36sec supports12secondwindows.
x=torch.full((1,3600),-20.)
x[0,500]=3;x[0,1900]=4;x[0,3300]=3
labels=torch.zeros((1,10,3600));labels[0,2,:1000]=3;labels[0,8,1000:2400]=3;labels[0,9,2400:]=3
output=SimpleNamespace(logits_section=x,logits_function=labels)
a=postprocess_functional_structure(output,cfg);b=functional_segments(output,cfg)
assert len(a)==len(b)
for x,y in zip(a,b):
    assert x.start==y['start_seconds'] and x.end==y['end_seconds'] and x.label==y['label'],(x,y)
print(json.dumps({'status':'passed','segments':b,'limits':'One synthetic activationcase validatesfunctionaldecoder sourceagreement; no modelorfrontendparity claim.'}))
