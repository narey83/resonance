"""Separate experimental profiles; never overwrite musical labels or singing spans."""
import math
from singing_engine import detect_scores

def processed_voice(scores, duration, identity=None, singing_bins=None):
 result=detect_scores(scores,duration,on=.5,off=.3)
 result.update(engine='Silero-speech-on-separated-vocals',identity=identity,confidence=None,limitations=['Speech detector on separated vocals; music bleed can cause false detections','Separate audition aid; does not replace singing detection','Related 15-track proxy validation does not establish general accuracy'])
 sustained=detect_scores(scores,duration,on=.5,off=.3,min_seconds=6)
 if singing_bins is not None:
  if len(singing_bins)!=len(scores):raise ValueError('Singing coverage must match speech coverage')
  refined=detect_scores(scores,duration,on=.5,off=.4,min_seconds=6)
  flags=[b['possibleVocals'] for b in refined['bins']]
  for segment in sustained['segments']:
   lo=int(segment['startSeconds']);hi=math.ceil(segment['endSeconds'])
   if sum(bool(b['possibleVocals']) for b in singing_bins[lo:hi])>=2:flags[lo:hi]=[True]*(hi-lo)
  sustained=detect_scores([float(v) for v in flags],duration,.5,.5,min_seconds=6,gap_seconds=0)
  sustained['settings'].update(speechOnScore=.5,speechOffScore=.4,singingSupportSeconds=2,profile='singing-supported-sustained-v2')
 result['sustainedSegments']=sustained['segments'];result['sustainedSettings']=sustained['settings']
 result['sustainedLimitations']='Stricter duration filter; short real vocal phrases can be omitted. Not validated as more accurate across the corpus.'
 for segment in result['segments']+result['sustainedSegments']:segment['label']='possible speech / processed vocals'
 for row in result['bins']:row['speechScore']=row.pop('singingScore')
 return result

def dj_structure(segments, bins, duration, bass_bins=None):
 """Conservative energy roles on existing independent musical boundaries."""
 rows=[]
 for segment in segments:
  start=max(0,float(segment['start_seconds']));end=min(duration,float(segment['end_seconds']))
  if end-start<2:continue
  values=[float(b['rms']) for b in bins if start<=float(b.get('startSeconds',0))<end]
  bass=[float(b['rms']) for b in (bass_bins or []) if start<=float(b['startSeconds'])<end]
  edge=max(1,min(4,len(values)//3));head=sum(values[:edge])/edge if values else 0;tail=sum(values[-edge:])/edge if values else 0
  rows.append({'start_seconds':start,'end_seconds':end,'label':'Transition','energy':sum(values)/len(values) if values else None,'bassRms':sum(bass)/len(bass) if bass else None,'percussionRiseRatio':tail/max(head,1e-8),'percussionHeadRms':head,'percussionTailRms':tail})
 energies=sorted(r['energy'] for r in rows if r['energy'] is not None)
 if energies:
  low=energies[len(energies)//4];high=energies[3*len(energies)//4]
  for i,row in enumerate(rows):
   value=row['energy']
   if value is None:continue
   if value<high*.4:row['label']='Breakdown'
   elif value>=high and value>low*1.4:
    previous=rows[i-1]['percussionTailRms'] if i else value
    row['label']='Drop entrance' if row['percussionHeadRms']>max(previous*1.6,high*.5) else 'High-energy groove'
   else:row['label']='Groove'
   if i+1<len(rows) and rows[i+1]['energy'] is not None and value<rows[i+1]['energy']*.65 and row['percussionRiseRatio']>=1.6 and row['percussionTailRms']>=high*.25:row['label']='Buildup'
   if row['bassRms'] is not None and row['bassRms']<.001 and value<high*.4 and row['label']=='Breakdown':row['label']='Sparse break'
 if rows:
  rows[0]['label']='Intro';rows[-1]['label']='Outro'
  if rows[0]['start_seconds']<=2:rows[0]['start_seconds']=0.0
  if duration-rows[-1]['end_seconds']<=2:rows[-1]['end_seconds']=duration
 for row in rows:row['percussionRms']=row.pop('energy')
 source_sections=[dict(row) for row in rows];merged=[]
 for row in rows:
  if merged and row['label']==merged[-1]['label'] and abs(row['start_seconds']-merged[-1]['end_seconds'])<.02:
   previous=merged[-1];a=previous['end_seconds']-previous['start_seconds'];b=row['end_seconds']-row['start_seconds']
   for key in ['percussionRms','bassRms']:
    if previous[key] is not None and row[key] is not None:previous[key]=(previous[key]*a+row[key]*b)/(a+b)
   previous['end_seconds']=row['end_seconds'];previous['percussionTailRms']=row['percussionTailRms'];previous['percussionRiseRatio']=previous['percussionTailRms']/max(previous['percussionHeadRms'],1e-8);previous['sourceSectionCount']+=1
  else:merged.append(dict(row,sourceSectionCount=1))
 return {'engine':'independent-DJ-boundary-profile','revision':'energy-transitions-v3','sourceSections':source_sections,'experimental':True,'segments':merged,'confidence':None,'limitations':['DJ arrangement suggestions on musical-model boundaries; not Rekordbox phrase parity','Energy heuristics can confuse drops, grooves and buildups; audition required','Musical verse/chorus predictions remain separate and unchanged']}


def percussion_bins(stem, ffmpeg, step_seconds=1.0):
 import subprocess,numpy as np
 audio=np.frombuffer(subprocess.check_output([ffmpeg,'-v','error','-i',str(stem),'-ar','8000','-ac','1','-f','f32le','-']),dtype='<f4')
 if not math.isfinite(step_seconds) or step_seconds<=0:raise ValueError('Positive percussion step required')
 step=max(1,round(step_seconds*8000))
 return [{'startSeconds':i/8000,'rms':float(np.sqrt(np.mean(audio[i:i+step].astype(float)**2)))} for i in range(0,len(audio),step)]
