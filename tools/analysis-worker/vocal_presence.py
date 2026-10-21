"""Experimental hysteresis on separated-vocal energy; no calibrated classifier claim."""
import math

def detect_presence(bins, duration_seconds, window_seconds=1, on_dbfs=-40, off_dbfs=-45, on_ratio=.25, off_ratio=.15, min_presence_seconds=2, max_gap_seconds=1):
    settings=dict(onDbfs=on_dbfs,offDbfs=off_dbfs,onRatio=on_ratio,offRatio=off_ratio,minPresenceSeconds=min_presence_seconds,maxGapSeconds=max_gap_seconds)
    if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in [duration_seconds,window_seconds,*settings.values()]):
        raise ValueError('Finite numeric settings required')
    if duration_seconds<=0 or window_seconds<=0 or not -120<=off_dbfs<=on_dbfs<=0 or not 0<=off_ratio<=on_ratio<=1 or not 0<=max_gap_seconds<=10 or not 0<min_presence_seconds<=30:
        raise ValueError('Invalid duration, hysteresis or smoothing settings')
    if not bins or abs(bins[0]['startSeconds'])>1e-5 or abs(len(bins)-math.ceil(duration_seconds/window_seconds))>0:
        raise ValueError('Complete nonempty vocal energy coverage required')
    flags=[];active=False;previous=-1
    for row in bins:
        start=row['startSeconds'];dbfs=row['vocalRmsDbfs'];ratio=row['vocalToMixtureRmsRatio']
        if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in [start,dbfs,ratio]) or start<0 or start<=previous or start>=duration_seconds or ratio<0:
            raise ValueError('Invalid or unordered vocal energy bins')
        if flags and abs(start-(previous+window_seconds))>1e-5:
            raise ValueError('Contiguous fixed-window bins required')
        active = dbfs >= (off_dbfs if active else on_dbfs) and ratio >= (off_ratio if active else on_ratio)
        flags.append(bool(active));previous=start
    # Fill only bounded gaps between positive windows, then remove brief runs.
    i=0
    while i<len(flags):
        j=i+1
        while j<len(flags) and flags[j]==flags[i]:j+=1
        if not flags[i] and i>0 and j<len(flags) and (j-i)*window_seconds<=max_gap_seconds:
            flags[i:j]=[True]*(j-i)
        i=j
    segments=[];i=0
    while i<len(flags):
        j=i+1
        while j<len(flags) and flags[j]==flags[i]:j+=1
        start=bins[i]['startSeconds'];end=min(duration_seconds,bins[j-1]['startSeconds']+window_seconds)
        if flags[i] and end-start>=min_presence_seconds:
            segments.append({'startSeconds':start,'endSeconds':end,'label':'possible vocals'})
        elif flags[i]:flags[i:j]=[False]*(j-i)
        i=j
    return {'engine':'Separated-vocal-energy-hysteresis','version':'0.1-experimental','experimental':True,'segments':segments,'bins':[{'startSeconds':row['startSeconds'],'possibleVocals':flag} for row,flag in zip(bins,flags)],'windowSeconds':window_seconds,'durationSeconds':duration_seconds,'settings':settings,'confidence':None,'limitations':['Thresholds are configurable heuristics, not calibrated probabilities.','Separation bleed can cause false detections; quiet vocals can be missed.','Spleeter segment seams can affect detections.','No singing/speech distinction or Rekordbox vocal-bin equivalence is claimed.']}
