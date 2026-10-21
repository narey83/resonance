import copy
import unittest
from dj_boundaries import refine_dj_boundaries

class DjBoundaries(unittest.TestCase):
    def profile(self, start=0):
        return {'segments': [{'start_seconds': 0, 'end_seconds': start, 'label': 'Breakdown'}, {'start_seconds': start, 'end_seconds': 32, 'label': 'Buildup'}, {'start_seconds': 32, 'end_seconds': 64, 'label': 'Groove'}] if start else [{'start_seconds': 0, 'end_seconds': 32, 'label': 'Buildup'}, {'start_seconds': 32, 'end_seconds': 64, 'label': 'Groove'}]}
    def bins(self, values):
        return [{'startSeconds': i, 'rms': v} for i, v in enumerate(values)]
    def test_opening_crash_does_not_extend_buildup_across_quiet_bars(self):
        profile = self.profile(); before = copy.deepcopy(profile)
        result = refine_dj_boundaries(profile, self.bins([.2]*2+[.001]*14+[.03]*4+[.06]*4+[.1]*8+[.25]*32),64,list(range(0,65,2)))
        self.assertEqual([(r['start_seconds'],r['end_seconds'],r['label']) for r in result['segments']],[(0,16.,'Breakdown'),(16.,32,'Buildup'),(32,64,'Groove')])
        self.assertEqual(profile,before)
    def test_continuous_ramp_keeps_original_start(self):
        profile = self.profile()
        result = refine_dj_boundaries(profile,self.bins([.03+i*.003 for i in range(64)]),64,list(range(0,65,2)))
        self.assertEqual([(r['start_seconds'],r['end_seconds'],r['label']) for r in result['segments']],[(0,32,'Buildup'),(32,64,'Groove')])
    def test_short_fill_or_quiet_gap_is_not_a_new_phrase(self):
        result=refine_dj_boundaries(self.profile(),self.bins([.1]*8+[.001]*4+[.1]*52),64,list(range(0,65,2)))
        self.assertFalse(any(c['kind']=='quiet-leading-buildup' for c in result['boundaryRefinement']['changes']))
    def test_invalid_or_missing_grid_leaves_original_timing(self):
        for grid in [None,[0,2,2],list(range(14))+[float('nan')]]:
            profile=self.profile();r=refine_dj_boundaries(profile,self.bins([.1]*64),64,grid)
            self.assertEqual(r['segments'],profile['segments']);self.assertEqual(r['boundaryRefinement']['status'],'not-run')
    def test_shared_boundary_snaps_once_without_gaps(self):
        profile=self.profile(8.2);r=refine_dj_boundaries(profile,self.bins([.1]*64),64,list(range(0,65,2)))
        self.assertEqual(r['segments'][0]['end_seconds'],8);self.assertEqual(r['segments'][1]['start_seconds'],8)
    def test_nonstandard_boundary_is_not_forced_to_grid(self):
        profile=self.profile(9);r=refine_dj_boundaries(profile,self.bins([.1]*64),64,list(range(0,65,2)))
        self.assertEqual(r['segments'][1]['start_seconds'],9)

if __name__ == '__main__':unittest.main()
