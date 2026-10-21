import copy
import math
import random
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from dj_arrangement import analyze_arrangement,genre_context,extract_frames,_weighted_mean

class Arrangement(unittest.TestCase):
    def setUp(self):
        self.duration=128.;self.grid=list(np.arange(0,128,2.));self.profile={'segments':[{'start_seconds':0.,'end_seconds':16.,'label':'Intro'},{'start_seconds':16.,'end_seconds':32.,'label':'Breakdown'},{'start_seconds':32.,'end_seconds':96.,'label':'Groove'},{'start_seconds':96.,'end_seconds':128.,'label':'Outro'}]}
        self.musical=[dict(s,label={'Intro':'intro','Outro':'outro'}.get(s['label'],'inst')) for s in self.profile['segments']]
        self.frames={'stepSeconds':1.,'durationSeconds':128.,**{k:[.2]*128 for k in ['drums','bass','other','vocals','kick','brightness']},'chroma':[[1.]+[0.]*11 for _ in range(128)]}
        self.genre={'scores':[{'label':'Trance','cosine':.5},{'label':'Techno','cosine':.3}]}
    def run_analysis(self,frames=None,profile=None,grid=None,genre=None):
        return analyze_arrangement(profile or self.profile,self.musical,frames or self.frames,self.duration,self.grid if grid is None else grid,self.genre if genre is None else genre)
    def check_timeline(self,result):
        rows=result['segments'];self.assertEqual(rows[0]['start_seconds'],0);self.assertEqual(rows[-1]['end_seconds'],self.duration)
        for row in rows:self.assertTrue(math.isfinite(row['start_seconds']));self.assertLess(row['start_seconds'],row['end_seconds'])
        for a,b in zip(rows,rows[1:]):self.assertEqual(a['end_seconds'],b['start_seconds'])
    def test_steady_groove_has_no_buildup_or_drop(self):
        r=self.run_analysis();self.check_timeline(r);self.assertFalse(any(s['label'] in ['Buildup','Drop entrance'] for s in r['segments']))
    def test_all_input_objects_are_preserved(self):
        before=copy.deepcopy([self.profile,self.frames,self.musical,self.genre]);self.run_analysis();self.assertEqual(before,[self.profile,self.frames,self.musical,self.genre])
    def test_silence_does_not_get_confident_intro_groove_or_drop(self):
        for k in ['drums','bass','other','vocals','kick','brightness']:self.frames[k]=[0.]*128
        r=self.run_analysis();self.assertEqual(len(r['segments']),1);self.assertEqual(r['segments'][0]['label'],'Silence');self.check_timeline(r)
    def test_melodic_buildup_detected_without_drum_ramp(self):
        for k in ['drums','kick','bass']:self.frames[k][:32]=[0.]*32
        self.frames['other'][16:32]=np.linspace(.02,.2,16).tolist();self.frames['brightness'][16:32]=np.linspace(.05,.3,16).tolist()
        r=self.run_analysis();self.check_timeline(r);self.assertTrue(any(s['label']=='Buildup' and s['start_seconds']<32 and s['end_seconds']<=34 for s in r['segments']))
    def test_strong_melodic_buildup_survives_unknown_or_wrong_genre(self):
        for k in ['drums','kick','bass']:self.frames[k][:32]=[0.]*32
        self.frames['other'][16:32]=np.linspace(.01,.3,16).tolist();self.frames['brightness'][16:32]=np.linspace(.02,.5,16).tolist()
        for genre in [{}, {'scores':[{'label':'Rock','cosine':.8}]}]:
            r=self.run_analysis(genre=genre);self.assertTrue(any(s['label']=='Buildup' for s in r['segments']))
    def test_drum_ramp_before_kick_return_detected(self):
        self.frames['kick'][16:32]=[.01]*16;self.frames['drums'][16:32]=np.linspace(.02,.15,16).tolist();self.frames['bass'][16:32]=[.01]*16
        r=self.run_analysis();self.assertTrue(any(s['label']=='Buildup' for s in r['segments']))
    def test_lone_crash_does_not_create_buildup(self):
        for k in ['drums','kick','bass']:self.frames[k][16:32]=[.001]*16
        self.frames['drums'][29]=10.
        r=self.run_analysis();self.assertFalse(any(s['label']=='Buildup' for s in r['segments']))
    def test_kick_and_bass_return_supports_drop(self):
        for k in ['drums','kick','bass']:self.frames[k][16:32]=[.001]*16
        r=self.run_analysis();self.assertTrue(any(s['label']=='Drop entrance' and abs(s['start_seconds']-32)<.1 for s in r['segments']))
    def test_quiet_melodic_section_supports_breakdown(self):
        for k in ['drums','kick']:self.frames[k][16:32]=[.001]*16
        r=self.run_analysis();self.assertTrue(any(s['label']=='Breakdown' and s['start_seconds']==16 for s in r['segments']))
    def test_invalid_grid_uses_neutral_touch_free_fallback(self):
        for grid in [[],[0,2,2],list(range(10))+[float('nan')],list(range(10))+[200]]:
            r=self.run_analysis(grid=grid);self.assertEqual(r['segments'][0]['label'],'Transition');self.assertTrue(r['automatic']);self.check_timeline(r)
    def test_variable_tempo_does_not_collapse_to_fallback(self):
        grid=np.cumsum([0]+[1.]*20+[3.]*30).tolist();r=self.run_analysis(grid=grid);self.assertEqual(r['boundaryDiagnostics']['status'],'applied');self.check_timeline(r)
    def test_invalid_acoustic_features_rejected(self):
        for value in [float('nan'),float('inf'),-.1]:
            f=copy.deepcopy(self.frames);f['drums'][5]=value
            with self.assertRaises(ValueError):self.run_analysis(frames=f)
    def test_incomplete_frames_and_chroma_rejected(self):
        for key in ['drums','chroma']:
            f=copy.deepcopy(self.frames);f[key]=f[key][:-10]
            with self.assertRaises(ValueError):self.run_analysis(frames=f)
    def test_nonfinite_model_boundary_rejected(self):
        p=copy.deepcopy(self.profile);p['segments'][1]['start_seconds']=float('nan')
        with self.assertRaises(ValueError):self.run_analysis(profile=p)
    def test_same_role_model_boundaries_preserved(self):
        p=copy.deepcopy(self.profile)
        for row in p['segments']:row['label']='Groove'
        r=self.run_analysis(profile=p);self.assertEqual([s['start_seconds'] for s in r['segments']],[0.,16.,32.,96.])
    def test_hundred_seeded_timelines_have_no_gaps_overlap_or_invalid_values(self):
        rng=np.random.default_rng(20261016)
        for _ in range(100):
            f=copy.deepcopy(self.frames)
            for key in ['drums','bass','other','vocals','kick','brightness']:f[key]=rng.uniform(0,.4,128).tolist()
            f['chroma']=rng.uniform(0,1,(128,12)).tolist();r=self.run_analysis(frames=f,genre={'scores':[]});self.check_timeline(r)
            self.assertIsNone(r['confidence']);self.assertTrue(r['automatic'])

class Routing(unittest.TestCase):
    def test_missing_and_malformed_genre_falls_back(self):
        for genre in [None,{},[],{'scores':None},{'scores':[None,{}, {'label':'Trance','cosine':float('nan')}]}]:
            self.assertEqual(genre_context(genre)['weights'],{'generic':1.})
    def test_genre_scores_are_not_claimed_as_probabilities(self):
        r=genre_context({'scores':[{'label':'Trance','cosine':.4},{'label':'Techno','cosine':.39}]});self.assertGreater(r['weights']['trance'],0);self.assertGreater(r['weights']['rhythmic'],0);self.assertIn('not calibrated',r['semantics'])
    def test_strong_trance_evidence_uses_longer_melodic_context(self):
        r=genre_context({'scores':[{'label':'Trance','cosine':.5},{'label':'Rock','cosine':.1}]});self.assertEqual(r['contextBars'],8);self.assertEqual(r['melodicWeight'],.5)
    def test_all_unknown_genres_remain_generic(self):
        r=genre_context({'scores':[{'label':'Unrecognised','cosine':.5}]});self.assertEqual(r['weights'],{'generic':1.})

class Measurement(unittest.TestCase):
    def test_fractional_windows_weight_real_overlap(self):
        self.assertAlmostEqual(float(_weighted_mean(np.array([0.,1.]),.5,1.5,1,2)),.5)
    def test_final_partial_frame_does_not_include_padding(self):
        self.assertAlmostEqual(float(_weighted_mean(np.array([1.,3.]),1.,1.2,1.,1.2)),3.)
    @patch('dj_arrangement.subprocess.check_output')
    def test_feature_extraction_measures_tones_and_preserves_duration(self,mock):
        sr=8000;t=np.arange(sr)/sr;mock.return_value=(.2*np.sin(2*np.pi*100*t)).astype('<f4').tobytes()
        f=extract_frames(Path('/test/stems'),'ffmpeg',1.);self.assertEqual(len(f['drums']),10);self.assertTrue(all(v>0 for v in f['kick']));self.assertEqual(np.asarray(f['chroma']).shape,(10,12))
    @patch('dj_arrangement.subprocess.check_output')
    def test_duration_mismatch_rejected(self,mock):
        mock.return_value=np.zeros(800,dtype='<f4').tobytes()
        with self.assertRaises(ValueError):extract_frames(Path('/test/stems'),'ffmpeg',2.)

if __name__=='__main__':unittest.main()
