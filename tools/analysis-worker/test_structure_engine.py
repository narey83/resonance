"""Meaningful deterministic signal cases for original experimental heuristics."""
import json
from pathlib import Path
import numpy as np
from structure_engine import analyze_structure

def run_tests():
    rate=8000;duration=48;t=np.arange(rate*duration)/rate
    beats=np.arange(0,duration,.5)
    steady=.2*np.sin(2*np.pi*220*t)
    same=analyze_structure(steady,rate,beats)
    assert not same['boundary_candidates'],'Steadytone invented sectionchanges'
    assert not analyze_structure(np.zeros_like(steady),rate,beats)['boundary_candidates'],'Silence invented sectionchanges'
    transition=np.where(t<16,.12*np.sin(2*np.pi*220*t),np.where(t<32,.35*np.sin(2*np.pi*523.25*t),.08*np.sin(2*np.pi*110*t)))
    changed=analyze_structure(transition,rate,beats)
    times=[v['seconds'] for v in changed['boundary_candidates']]
    assert len(times)==2,(times,'Expectedtwo knownchanges')
    assert all(min(abs(v-target) for v in times)<=1 for target in (16,32)),times
    assert len(changed['sections'])==3 and all(s['semantic_type'] is None for s in changed['sections'])
    assert all(b['seconds']>a['seconds'] for a,b in zip(changed['cue_proposals'],changed['cue_proposals'][1:]))
    assert all(j['beat_index']-i['beat_index']>=16 for i,j in zip(changed['boundary_candidates'],changed['boundary_candidates'][1:]))
    for bad in ([],[0],[0,0],[1,0],[0,float('nan')]):
        try:analyze_structure(steady,rate,bad)
        except ValueError:pass
        else:raise AssertionError('Acceptedinvalidbeatgrid '+str(bad))
    invalid_inputs=[(steady,0,{}),(steady,float('nan'),{}),(steady,float('inf'),{}),(steady,-1,{}),(steady,'8000',{}),(steady,True,{}),(np.c_[steady,steady],rate,{}),(np.array([float('nan')]),rate,{})]
    for key in ('context_beats','min_spacing_beats','max_cues'):
        for bad in (0,-1,1.5,True):invalid_inputs.append((steady,rate,{key:bad}))
    for signal,sr,settings in invalid_inputs:
        try:analyze_structure(signal,sr,beats,**settings)
        except ValueError:pass
        else:raise AssertionError('Invalid audio/rate/setting accepted '+str((sr,settings)))
    return {'status':'passed','cases':['steady sinusoid and silence: no boundaries','three distinct tone/energy sections: two boundaries within1second','section labels contain no semanticclassification','cue timestamps sorted; conservativeboundaryspacing','missing/nonmonotonic/nonfinitegrid rejected','nonpositive/nonfinite/nonnumeric rates, stereo/nonfinite audio, fractional/bool/nonpositive integer settings rejected'],'known_transition_seconds':[16,32],'detected_transition_seconds':times,'limitations':'Synthetic tests validate deterministic heuristic behavior; not musicalstructureaccuracy or Rekordboxparity.'}
if __name__=='__main__':
    result=run_tests();path=Path(__file__).with_name('structure-test-results.json');path.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
