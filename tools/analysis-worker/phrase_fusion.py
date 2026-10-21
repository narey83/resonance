"""Fuse independent acoustic and model boundaries without inventing semantic labels."""
import math

def fuse_sections(sections,segments,duration,tolerance_seconds=2):
 if not math.isfinite(duration) or duration<=0:raise ValueError('Positive finite duration required')
 if not math.isfinite(tolerance_seconds) or tolerance_seconds<0:raise ValueError('Nonnegative finite tolerance required')
 def boundaries(rows):
  points=[]
  for row in rows:
   start=float(row['start_seconds']);end=float(row['end_seconds'])
   if not math.isfinite(start) or not math.isfinite(end) or not 0<=start<end<=duration+.1:raise ValueError('Invalid section time')
   if tolerance_seconds<start<duration-tolerance_seconds:points.append(start)
  return sorted(set(points))
 acoustic=boundaries(sections);semantic=boundaries(segments)
 # Keep the semantic model's timestamp for a shared event; retain additional
 # acoustic changes that have no model event within the fixed tolerance.
 points=sorted(semantic+[p for p in acoustic if not any(abs(p-q)<=tolerance_seconds for q in semantic)])
 starts=[0.]+points
 return {'engine':'Independent-boundary-union','experimental':True,'sections':[{'label':f'Section {i+1}','start_seconds':a,'end_seconds':b,'semantic_type':None} for i,(a,b) in enumerate(zip(starts,starts[1:]+[duration]))],'boundarySources':{'acousticSeconds':acoustic,'semanticSeconds':semantic},'settings':{'mergeToleranceSeconds':tolerance_seconds,'edgeExclusionSeconds':tolerance_seconds,'sharedEventTimestamp':'semantic model'},'confidence':None,'semantics':'Union of independent acoustic novelty and functional-model changes. Generic numbered sections only; no new semantic labels or calibrated confidence.'}
