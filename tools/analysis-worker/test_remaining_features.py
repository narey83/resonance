import unittest
import numpy as np
from loop_engine import propose_loops
from vocal_presence import detect_presence

class Loops(unittest.TestCase):
    def setUp(self):
        self.rate=8000;self.beats=np.arange(0,12.01,.5);t=np.arange(12*self.rate)/self.rate;self.audio=.2*np.sin(2*np.pi*220*t)
    def test_periodic_audio_yields_aligned_bounded_ranked_ranges(self):
        r=propose_loops(self.audio,self.rate,self.beats,self.beats[::4])
        self.assertTrue(r['proposals']);self.assertIsNone(r['confidence'])
        for p in r['proposals']:
            self.assertEqual(p['startSeconds'],self.beats[p['startBeatIndex']]);self.assertEqual(p['endSeconds'],self.beats[p['endBeatIndex']]);self.assertEqual(p['endBeatIndex']-p['startBeatIndex'],p['beatCount']);self.assertLessEqual(p['endSeconds'],12);self.assertTrue(p['downbeatAligned'])
        self.assertEqual([p['rankingScore'] for p in r['proposals']],sorted([p['rankingScore'] for p in r['proposals']],reverse=True))
    def test_silence_has_no_proposals(self):
        self.assertEqual(propose_loops(np.zeros_like(self.audio),self.rate,self.beats)['proposals'],[])
    def test_variable_tempo_preserves_actual_timestamps(self):
        beats=np.cumsum([0,.4,.5,.6,.45,.55,.7,.5,.6,.5,.4,.6]);r=propose_loops(self.audio,self.rate,beats,beat_counts=[4])
        self.assertTrue(r['proposals'])
        for p in r['proposals']:self.assertAlmostEqual(p['endSeconds']-p['startSeconds'],beats[p['endBeatIndex']]-beats[p['startBeatIndex']])
    def test_transition_scores_worse_than_periodic_boundary(self):
        x=self.audio.copy();x[8000:16000]=.2*np.sin(2*np.pi*900*np.arange(8000)/self.rate)
        beats=np.arange(0,2.01,.5)
        stable=propose_loops(self.audio[:16000],self.rate,beats,beat_counts=[4])['proposals'][0]
        unstable=propose_loops(x[:16000],self.rate,beats,beat_counts=[4])['proposals'][0]
        self.assertGreater(stable['spectralBoundarySimilarity'],unstable['spectralBoundarySimilarity'])
    def test_invalid_audio_grid_and_counts_rejected(self):
        cases=[(np.array([np.nan]),8000,[0,1],{}),(self.audio,0,[0,1],{}),(self.audio,8000,[0,1,1],{}),(self.audio,8000,[-1,0],{}),(self.audio,8000,[0,1],{'beat_counts':[0]}),(self.audio,8000,[0,1],{'max_loops':True})]
        for audio,rate,beats,kw in cases:
            with self.assertRaises(ValueError):propose_loops(audio,rate,beats,**kw)

class Vocals(unittest.TestCase):
    def bins(self,values):return [{'startSeconds':float(i),'vocalRmsDbfs':db,'vocalToMixtureRmsRatio':ratio} for i,(db,ratio) in enumerate(values)]
    def test_hysteresis_retains_borderline_energy(self):
        r=detect_presence(self.bins([(-60,.01),(-30,.3),(-42,.2),(-60,.01)]),4,max_gap_seconds=0)
        self.assertEqual(r['segments'],[{'startSeconds':1.,'endSeconds':3.,'label':'possible vocals'}]);self.assertIsNone(r['confidence'])
    def test_both_absolute_and_relative_energy_required(self):
        for value in [(-60,.9),(-10,.01)]:self.assertEqual(detect_presence(self.bins([value]*4),4)['segments'],[])
    def test_short_positive_runs_removed_and_short_internal_gap_filled(self):
        r=detect_presence(self.bins([(-30,.5),(-60,0),(-30,.5),(-30,.5),(-60,0),(-60,0),(-30,.5)]),7)
        self.assertEqual(r['segments'],[{'startSeconds':0.,'endSeconds':4.,'label':'possible vocals'}])
    def test_partial_last_window_clipped(self):
        r=detect_presence(self.bins([(-30,.5)]*3),2.5)
        self.assertEqual(r['segments'][0]['endSeconds'],2.5)
    def test_invalid_settings_and_incomplete_bins_rejected(self):
        for bins,duration,kw in [(self.bins([(-30,.5)]),2,{}),([],2,{}),(self.bins([(-30,.5)]*2),2,{'on_ratio':.1,'off_ratio':.2}),(self.bins([(-30,float('nan'))]*2),2,{})]:
            with self.assertRaises(ValueError):detect_presence(bins,duration,**kw)

if __name__=='__main__':unittest.main()
