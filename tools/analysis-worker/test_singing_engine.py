import unittest
from singing_engine import detect_scores
class SingingTests(unittest.TestCase):
 def test_hysteresis_gap_and_tail(self):
  r=detect_scores([0.,.95,.6,.4,.95,.6,0.],6.5)
  self.assertEqual(r['segments'],[{'startSeconds':1.,'endSeconds':6,'label':'possible singing voice'}])
  self.assertEqual([b['possibleVocals'] for b in r['bins']],[False,True,True,True,True,True,False])
 def test_minimum_span_and_partial_tail(self):
  self.assertEqual(detect_scores([.95],.5)['segments'],[])
  self.assertEqual(detect_scores([0.,0.],2)['segments'],[])
 def test_invalid_coverage_and_scores(self):
  for scores,duration in [([],1),([float('nan')],1),([2.],1),([.9,.9],1),([.9],0)]:
   with self.assertRaises(ValueError):detect_scores(scores,duration)
if __name__=='__main__':unittest.main()
