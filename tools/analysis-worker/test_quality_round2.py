import unittest
import numpy as np
from phrase_fusion import fuse_sections
from embedding_engine import EmbeddingEngine
from genre_profiles import prompts

class QualityTests(unittest.TestCase):
 def test_shared_boundaries_keep_model_time_and_acoustic_only_events(self):
  def rows(points):return [{'start_seconds':a,'end_seconds':b} for a,b in zip(points,points[1:]+[100.])]
  result=fuse_sections(rows([0.,20.,50.,80.]),rows([0.,21.,60.]),100.)
  self.assertEqual([r['start_seconds'] for r in result['sections']],[0.,21.,50.,60.,80.])
  self.assertTrue(all(r['semantic_type'] is None for r in result['sections']))
 def test_invalid_times_rejected_and_complete_coverage(self):
  with self.assertRaises(ValueError):fuse_sections([{'start_seconds':-1,'end_seconds':5}],[],10)
  self.assertEqual(fuse_sections([],[],10)['sections'],[{'label':'Section 1','start_seconds':0.,'end_seconds':10,'semantic_type':None}])
 def test_genre_disambiguation_is_explicit_and_unknown_labels_preserved(self):
  self.assertIn('This is hardcore electronic dance music.',prompts('Hardcore','disambiguated'))
  self.assertEqual(prompts('Jazz','disambiguated'),['This is Jazz music.'])
  with self.assertRaises(ValueError):prompts('Jazz','invalid')

if __name__=='__main__':unittest.main()
