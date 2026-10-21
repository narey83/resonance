"""Independent cosine index; reject mixed model spaces and retain source hashes."""
from pathlib import Path
import argparse,hashlib,json
import numpy as np

def space_id(result):
    identity=result['identity']
    fields={k:identity[k] for k in ('engine','model_repo','checkpoint_sha256','config_sha256','dimension')}
    fields['pooling']=result['pooling']
    return hashlib.sha256(json.dumps(fields,sort_keys=True,separators=(',',':')).encode()).hexdigest(),fields

def vector(result):
    v=np.asarray(result['embedding'],dtype=np.float64)
    if v.shape!=(result['identity']['dimension'],) or not np.isfinite(v).all():raise ValueError('Invalid embedding dimensions or values')
    norm=float(np.linalg.norm(v))
    if norm<=1e-10:raise ValueError('Zero embedding')
    return v/norm

def build(records):
    if not records:raise ValueError('No embeddings supplied')
    expected,identity=space_id(records[0]['result']);ids=set();rows=[]
    for record in records:
        key=record['trackId'];audio_sha=record['audioSha256']
        if not isinstance(key,str) or not key or key in ids:raise ValueError('Invalid or duplicate track identity')
        if not isinstance(audio_sha,str) or len(audio_sha)!=64 or any(c not in '0123456789abcdef' for c in audio_sha):raise ValueError('Invalid audio SHA256')
        current,_=space_id(record['result'])
        if current!=expected:raise ValueError('Mixed model spaces or pooling methods')
        ids.add(key);rows.append({'trackId':key,'audioSha256':audio_sha,'vector':vector(record['result']).tolist()})
    return {'schemaVersion':1,'metric':'cosine','spaceId':expected,'space':identity,'tracks':rows,'scoreSemantics':'Cosine similarity, not calibrated relevance or genre confidence'}

def nearest(index,track_id,limit=10):
    if not isinstance(limit,int) or limit<1:raise ValueError('Positive integer limit required')
    rows=index['tracks'];matches=[r for r in rows if r['trackId']==track_id]
    if len(matches)!=1:raise ValueError('Query track missing or ambiguous')
    q=np.asarray(matches[0]['vector'],dtype=np.float64);scores=[]
    if q.shape!=(index['space']['dimension'],) or not np.isfinite(q).all() or np.linalg.norm(q)<=1e-10:raise ValueError('Corrupt query vector')
    for row in rows:
        if row['trackId']==track_id:continue
        v=np.asarray(row['vector'],dtype=np.float64)
        if v.shape!=q.shape or not np.isfinite(v).all() or np.linalg.norm(v)<=1e-10:raise ValueError('Corrupt index vector')
        score=float(np.dot(q,v)/max(np.linalg.norm(q)*np.linalg.norm(v),1e-15))
        scores.append({'trackId':row['trackId'],'audioSha256':row['audioSha256'],'cosine':max(-1.,min(1.,score))})
    return sorted(scores,key=lambda r:(-r['cosine'],r['trackId']))[:limit]

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('records');p.add_argument('--output',required=True);a=p.parse_args();out=Path(a.output)
    if out.exists():raise ValueError('Output already exists')
    out.write_text(json.dumps(build(json.loads(Path(a.records).read_text())),indent=2)+'\n')
